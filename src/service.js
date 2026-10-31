// Servicio HTTP del contrato del reto: /health, /run, /run/:id, /output/:archivo, /anonymize, /entities.
// Corre igual en local (src/main.js) y en Vercel (api/index.js). En Vercel no hay disco compartido
// entre instancias: la salida es determinista, así que una instancia fría la recalcula desde el API de fuentes.
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fetchSources, diffIndex } from './sources.js';
import { runPipeline, saveStored } from './pipeline.js';
import { anonymizeBatch } from './live.js';

const SERVERLESS = !!process.env.VERCEL;
const DATA = process.env.DATA_DIR || (SERVERLESS ? '/tmp/kipu' : path.resolve('data'));
const BUNDLED_STORED = path.resolve('data/pseudonyms.json');
const STORED = path.join(DATA, 'pseudonyms.json');
const OUT = path.join(DATA, 'output');
const SRC = path.join(DATA, 'sources');
const EMPTY = path.resolve('src/empty');
const VERSION = '1.1.0';
const FILES = ['chats.jsonl', 'docs.jsonl', 'tables.jsonl', 'entities.json'];

const jobs = new Map();
let state = null;
let pending = null;

fs.mkdirSync(DATA, { recursive: true });
if (!fs.existsSync(STORED) && fs.existsSync(BUNDLED_STORED)) fs.copyFileSync(BUNDLED_STORED, STORED);

const log = (job, msg) => { const l = `[${new Date().toISOString()}] ${msg}`; console.log(l); job?.log.push(l); };

// las regeneraciones van en fila: nunca dos a la vez sobre el mismo disco
let queue = Promise.resolve();

/** Baja las fuentes y regenera output/ desde cero. Devuelve el resumen de la corrida. */
function regenerate(sourcesUrl, token, job) {
  const run = queue.then(() => regenerateNow(sourcesUrl, token, job));
  queue = run.catch(() => {});
  return run;
}

async function regenerateNow(sourcesUrl, token, job) {
  const t0 = Date.now();
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const next = path.join(DATA, `sources-${tag}`);
  const outNext = path.join(DATA, `output-${tag}`);
  try {
    await fetchSources(sourcesUrl, token, next, m => log(job, m));
    // detección del incidente: el record_index crece respecto a la corrida anterior
    const diff = await diffIndex(path.join(SRC, 'record_index.json'), path.join(next, 'record_index.json'));
    if (diff && Object.values(diff).some(d => d.added > 0)) log(job, `CAMBIO EN FUENTES detectado: ${JSON.stringify(diff)}`);
    const r = runPipeline({ srcDir: next, outDir: outNext, storedFile: STORED, log: m => log(job, m) });
    fs.rmSync(SRC, { recursive: true, force: true });
    fs.renameSync(next, SRC);
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.renameSync(outNext, OUT);
    state = { reg: r.reg, an: r.an, threads: r.threads };
    return { records: { chats: r.chats.length, docs: r.docs.length, tables: r.tables.length }, seconds: (Date.now() - t0) / 1000, source_diff: diff };
  } finally {
    fs.rmSync(next, { recursive: true, force: true });
    fs.rmSync(outNext, { recursive: true, force: true });
  }
}

/** Garantiza registro en memoria: reusa lo que haya en disco o regenera con el token del entorno. */
async function ensureState() {
  if (state) return state;
  if (pending) return pending;
  pending = (async () => {
    try {
      if (fs.existsSync(path.join(SRC, 'record_index.json'))) {
        const r = runPipeline({ srcDir: SRC, outDir: OUT, storedFile: STORED });
        state = { reg: r.reg, an: r.an, threads: r.threads };
      } else if (process.env.FUENTES_API && process.env.FUENTES_TOKEN) {
        await regenerate(process.env.FUENTES_API, process.env.FUENTES_TOKEN, null);
      } else {
        const r = runPipeline({ srcDir: EMPTY, outDir: null, storedFile: STORED });
        state = { reg: r.reg, an: r.an, threads: r.threads };
      }
      return state;
    } finally { pending = null; }
  })();
  return pending;
}

function encodeJob(j) {
  return Buffer.from(JSON.stringify({ s: j.status, r: j.records, c: j.cost, a: j.started_at, f: j.finished_at, e: j.error })).toString('base64url');
}

export const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024, routerOptions: { maxParamLength: 2000 } });

function routes(prefix) {
  app.get(`${prefix}/health`, async () => ({ status: 'ok', team: process.env.TEAM_NAME || 'Edgar', version: VERSION, models: [] }));

  app.post(`${prefix}/run`, async (req, reply) => {
    const { sources_url, token } = req.body || {};
    if (!sources_url || !token) return reply.code(422).send({ error: 'faltan sources_url o token' });
    const job = { status: 'running', started_at: new Date().toISOString(), log: [] };
    const work = (async () => {
      try {
        const r = await regenerate(sources_url, token, job);
        Object.assign(job, { status: 'done', records: r.records, cost: { tokens_in: 0, tokens_out: 0, seconds: r.seconds }, source_diff: r.source_diff });
      } catch (err) {
        Object.assign(job, { status: 'failed', error: String(err?.message || err) });
      }
      job.finished_at = new Date().toISOString();
    })();
    // en serverless la corrida termina dentro de la misma invocación (tarda segundos)
    if (SERVERLESS) await work;
    const id = SERVERLESS ? `j_${encodeJob(job)}` : `j_${Date.now().toString(36)}`;
    jobs.set(id, job);
    return reply.code(202).send({ job_id: id });
  });

  app.get(`${prefix}/run/:id`, async (req, reply) => {
    const j = jobs.get(req.params.id);
    if (j) { const { log: l, ...rest } = j; return { ...rest, log_tail: l.slice(-6) }; }
    if (req.params.id.startsWith('j_')) {
      try {
        const d = JSON.parse(Buffer.from(req.params.id.slice(2), 'base64url').toString('utf8'));
        return { status: d.s, records: d.r, cost: d.c, started_at: d.a, finished_at: d.f, error: d.e };
      } catch { /* id local */ }
    }
    return reply.code(404).send({ error: 'no existe' });
  });

  const serveFile = async (f, reply) => {
    if (!FILES.includes(f)) return reply.code(404).send({ error: 'no existe' });
    if (!fs.existsSync(path.join(OUT, f))) await ensureState();
    const p = path.join(OUT, f);
    if (!fs.existsSync(p)) return reply.code(404).send({ error: 'no hay corrida terminada' });
    reply.type(f.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/x-ndjson; charset=utf-8');
    return reply.send(fs.readFileSync(p));
  };
  app.get(`${prefix}/output/:file`, async (req, reply) => serveFile(req.params.file, reply));
  app.get(`${prefix}/entities`, async (req, reply) => serveFile('entities.json', reply));

  app.post(`${prefix}/anonymize`, async (req, reply) => {
    const { source, records } = req.body || {};
    if (!['chats', 'docs', 'tables'].includes(source) || !Array.isArray(records)) return reply.code(422).send({ error: 'esperaba {source, records}' });
    if (records.length > 50) return reply.code(422).send({ error: 'máximo 50 registros por lote' });
    const st = await ensureState();
    const out = anonymizeBatch(st, source, records);
    try { saveStored(STORED, st.reg); } catch { /* disco opcional */ }
    return out;
  });
}

routes('/v1');
routes('');
// la raíz (con o sin /v1) responde como /health, por si el evaluador o un navegador abren la URL base
const root = async () => ({ status: 'ok', team: process.env.TEAM_NAME || 'Edgar', version: VERSION, models: [], service: 'kipu-anon', endpoints: ['/v1/health', '/v1/run', '/v1/run/{job_id}', '/v1/output/{archivo}', '/v1/anonymize', '/v1/entities'] });
const LANDING = path.resolve('public/index.html');
// la carátula solo se sirve a navegadores; clientes del API siguen recibiendo JSON
app.get('/', async (req, reply) => {
  if (/text\/html/.test(req.headers.accept || '') && fs.existsSync(LANDING)) return reply.type('text/html; charset=utf-8').send(fs.readFileSync(LANDING));
  return root();
});
app.get('/v1', root);
app.get('/v1/', root);

export { ensureState };
export default app;
