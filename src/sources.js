// Ingesta: baja todas las fuentes del API a un directorio y las lee de vuelta.
import fs from 'node:fs/promises';
import path from 'node:path';

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export async function fetchSources(sourcesUrl, token, dest, log = () => {}) {
  const base = sourcesUrl.replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${token}` };
  // el API permite 600 peticiones por minuto: ante 429 se espera lo que pida (Retry-After), hasta ~2 min
  async function get(p) {
    const deadline = Date.now() + 150_000;
    for (let attempt = 0; ; attempt++) {
      let r;
      try { r = await fetch(base + p, { headers }); } catch (e) { r = null; }
      if (r && r.ok) return Buffer.from(await r.arrayBuffer());
      if (r && r.status !== 429 && r.status < 500) throw new Error(`GET ${p} -> ${r.status}`);
      const ra = r && +r.headers.get('retry-after');
      const wait = ra > 0 ? ra * 1000 : Math.min(15_000, 1000 * 2 ** attempt);
      if (Date.now() + wait > deadline) throw new Error(`GET ${p} agotó reintentos (${r ? r.status : 'red'})`);
      await new Promise(s => setTimeout(s, wait + Math.random() * 500));
    }
  }
  const json = async p => JSON.parse((await get(p)).toString('utf8'));
  for (const d of ['chats', 'docs', 'tables']) await fs.mkdir(path.join(dest, d), { recursive: true });

  const [channels, users, docs, tables, recordIndex] = await Promise.all([
    json('/chats/channels'), json('/chats/users'), json('/docs'), json('/tables'), get('/record_index'),
  ]);
  await fs.writeFile(path.join(dest, 'chats/channels.json'), JSON.stringify(channels));
  await fs.writeFile(path.join(dest, 'chats/users.json'), JSON.stringify(users));
  await fs.writeFile(path.join(dest, 'docs/index.json'), JSON.stringify(docs));
  await fs.writeFile(path.join(dest, 'tables/index.json'), JSON.stringify(tables));
  await fs.writeFile(path.join(dest, 'record_index.json'), recordIndex);

  const jobs = [];
  for (const ch of channels) {
    let dates = await json(`/chats/${encodeURIComponent(ch.name)}`);
    if (!Array.isArray(dates)) dates = dates.dates || [];
    await fs.mkdir(path.join(dest, 'chats', ch.name), { recursive: true });
    for (const d of dates) jobs.push({ ch: ch.name, d: typeof d === 'string' ? d : d.date });
  }
  await pool(jobs, 6, async j => fs.writeFile(path.join(dest, 'chats', j.ch, `${j.d}.json`), await get(`/chats/${encodeURIComponent(j.ch)}/${j.d}`)));
  await pool(docs, 8, async d => fs.writeFile(path.join(dest, 'docs', d.filename), await get(`/docs/${encodeURIComponent(d.id)}`)));
  await pool(tables, 4, async t => fs.writeFile(path.join(dest, 'tables', t.name), await get(`/tables/${encodeURIComponent(t.name)}`)));
  const summary = { channels: channels.length, chat_days: jobs.length, docs: docs.length, tables: tables.length };
  log(`ingesta: ${JSON.stringify(summary)}`);
  return summary;
}

/** Compara el record_index nuevo contra el de la corrida anterior: así se detecta el incidente. */
export async function diffIndex(prevPath, nextPath) {
  let prev = null;
  try { prev = JSON.parse(await fs.readFile(prevPath, 'utf8')); } catch { return null; }
  const next = JSON.parse(await fs.readFile(nextPath, 'utf8'));
  const out = {};
  for (const k of Object.keys(next)) {
    const a = new Set(prev[k] || []);
    const added = (next[k] || []).filter(x => !a.has(x));
    const b = new Set(next[k] || []);
    const removed = (prev[k] || []).filter(x => !b.has(x));
    out[k] = { before: (prev[k] || []).length, after: (next[k] || []).length, added: added.length, removed: removed.length };
  }
  return out;
}
