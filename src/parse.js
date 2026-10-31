// Lee las fuentes crudas y las lleva al esquema normalizado de output/.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

// ---------- chats ----------
export function parseChats(dir) {
  const channels = readJson(path.join(dir, 'chats/channels.json'));
  const users = readJson(path.join(dir, 'chats/users.json'));
  const byId = new Map(users.map(u => [u.id, u]));
  const records = [];
  for (const ch of channels) {
    const cdir = path.join(dir, 'chats', ch.name);
    if (!fs.existsSync(cdir)) continue;
    for (const f of fs.readdirSync(cdir).filter(x => x.endsWith('.json')).sort()) {
      for (const m of readJson(path.join(cdir, f))) {
        if (!m.client_msg_id) continue;
        const u = byId.get(m.user);
        const author = u ? (u.real_name || u.profile?.real_name || u.name) : (m.username || m.user || '');
        records.push({
          id: m.client_msg_id,
          thread_id: `${ch.name}:${m.thread_ts || m.ts}`,
          author,
          ts: m.ts,
          text: m.text ?? '',
          attachments: (m.files || []).map(fl => ({ filename: fl.name ?? fl.title ?? '' })),
          _user: m.user,
          _channel: ch.name,
          _bot: !!(m.bot_id || m.subtype === 'bot_message' || u?.is_bot),
        });
      }
    }
  }
  return { channels, users, records };
}

// ---------- docs ----------
function frontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return {};
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return meta;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEnt = s => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (all, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()] ?? all;
});

function htmlToMarkdown(html) {
  let s = html.replace(/<!DOCTYPE[^>]*>/i, '');
  const comments = [];
  s = s.replace(/<!--[\s\S]*?-->/g, c => { comments.push(c); return `\u0000C${comments.length - 1}\u0000`; });
  s = s.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${'#'.repeat(+n)} ${t.trim()}\n\n`);
  s = s.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => {
    const cells = [...row.matchAll(/<t([hd])[^>]*>([\s\S]*?)<\/t\1>/gi)].map(c => c[2].replace(/\s+/g, ' ').trim());
    const isHead = /<th/i.test(row);
    return `\n| ${cells.join(' | ')} |${isHead ? `\n| ${cells.map(() => '---').join(' | ')} |` : ''}`;
  });
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `\n- ${t.trim()}`);
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|section|article|table|ul|ol|blockquote|header|footer)>/gi, '\n\n');
  s = s.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**').replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*');
  s = s.replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, h, t) => (h.startsWith('mailto:') || h === t ? t : `[${t}](${h})`));
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEnt(s);
  s = s.replace(/\u0000C(\d+)\u0000/g, (_, i) => comments[+i]);
  return s.split('\n').map(l => l.replace(/[ \t]+$/g, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function htmlMeta(html) {
  const meta = {};
  for (const m of html.matchAll(/<meta\s+([^>]*)>/gi)) {
    const name = (m[1].match(/(?:name|property)="([^"]*)"/i) || [])[1];
    const content = (m[1].match(/content="([^"]*)"/i) || [])[1];
    if (name && content !== undefined) meta[name] = decodeEnt(content);
  }
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
  return { meta, title: title ? decodeEnt(title.trim()) : null };
}

function pdfString(raw) {
  // (literal) o <hex>
  if (raw.startsWith('<')) {
    const hex = raw.slice(1, -1).replace(/\s/g, '');
    const buf = Buffer.from(hex, 'hex');
    if (buf[0] === 0xfe && buf[1] === 0xff) {
      let s = '';
      for (let i = 2; i + 1 < buf.length; i += 2) s += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
      return s;
    }
    return buf.toString('latin1');
  }
  let s = raw.slice(1, -1);
  s = s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[e] ?? String.fromCharCode(parseInt(e, 8))));
  return s;
}

function parsePdf(buf) {
  const s = buf.toString('latin1');
  const info = {};
  const trailerInfo = s.match(/\/Info\s+(\d+)\s+0\s+R/);
  if (trailerInfo) {
    const obj = s.match(new RegExp(`\\n${trailerInfo[1]}\\s+0\\s+obj\\s*<<([\\s\\S]*?)>>\\s*endobj`));
    if (obj) {
      for (const m of obj[1].matchAll(/\/(\w+)\s*(\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]*>)/g)) info[m[1].toLowerCase()] = pdfString(m[2]);
    }
  }
  const lines = [];
  const rx = /stream\r?\n/g;
  let m;
  while ((m = rx.exec(s))) {
    const st = m.index + m[0].length;
    const en = s.indexOf('endstream', st);
    let content;
    try { content = zlib.inflateSync(buf.subarray(st, en)).toString('latin1'); } catch { continue; }
    if (!/BT[\s\S]*Tj/.test(content)) continue;
    const items = [];
    for (const t of content.matchAll(/BT\s+([\d.\-]+)\s+([\d.\-]+)\s+Td[^()]*?(\((?:\\.|[^\\)])*\))\s*Tj/g)) {
      items.push({ x: +t[1], y: +t[2], text: pdfString(t[3]) });
    }
    // agrupar por línea (misma y) y ordenar por x; celdas de tabla se unen con " | "
    const rows = new Map();
    for (const it of items) {
      const key = Math.round(it.y);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(it);
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      const row = rows.get(y).sort((a, b) => a.x - b.x);
      lines.push(row.length > 1 ? `| ${row.map(r => r.text).join(' | ')} |` : row[0].text);
    }
  }
  // fpdf escribe WinAnsi: latin1 ya decodifica bien los acentos
  return { info, body: lines.join('\n') + '\n' };
}

export function parseDocs(dir) {
  const index = readJson(path.join(dir, 'docs/index.json'));
  return index.map(d => {
    const p = path.join(dir, 'docs', d.filename);
    const buf = fs.readFileSync(p);
    let body = '', metadata = {}, title = '';
    if (d.format === 'pdf') {
      const r = parsePdf(buf);
      body = r.body;
      metadata = r.info;
      title = r.info.title || r.body.split('\n')[0] || d.filename;
    } else if (d.format === 'html') {
      const html = buf.toString('utf8');
      const r = htmlMeta(html);
      metadata = r.meta;
      title = r.title || '';
      body = htmlToMarkdown(html);
    } else {
      body = buf.toString('utf8');
      metadata = frontMatter(body);
      title = metadata.title || (body.match(/^#\s+(.+)$/m) || [])[1] || d.filename;
    }
    return { id: d.id, format: d.format, filename: d.filename, title, body, metadata };
  });
}

// ---------- tables ----------
function parseCsv(text, sep) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

function xmlAttrs(s) {
  const o = {};
  for (const m of s.matchAll(/([\w:-]+)="([^"]*)"/g)) o[m[1]] = decodeEnt(m[2]);
  return o;
}

function parseXmlRows(text, tag) {
  const out = [];
  for (const m of text.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'g'))) {
    const cols = xmlAttrs(m[1]);
    for (const c of m[2].matchAll(/<([\w-]+)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
      let v = c[3];
      const cdata = v.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
      v = cdata ? cdata[1] : decodeEnt(v);
      cols[c[1]] = v;
      for (const [k, av] of Object.entries(xmlAttrs(c[2]))) cols[`${c[1]}_${k}`] = av;
    }
    out.push(cols);
  }
  return out;
}

export const TABLE_KEYS = { clientes: 'cliente_id', transacciones: 'tx_id', pqrs: 'radicado', empleados: 'id' };

export function parseTables(dir) {
  const ip = path.join(dir, 'tables/index.json');
  const index = fs.existsSync(ip) ? readJson(ip) : fs.readdirSync(path.join(dir, 'tables')).filter(f => /\.(csv|xml)$/.test(f)).map(f => ({
    name: f, format: f.endsWith('.csv') ? 'csv' : 'xml', charset: f === 'clientes.csv' ? 'latin-1' : 'utf-8', separator: f === 'clientes.csv' ? ';' : ',',
  }));
  const out = [];
  const raw = {};
  for (const t of index) {
    const buf = fs.readFileSync(path.join(dir, 'tables', t.name));
    const name = t.name.replace(/\.\w+$/, '');
    const text = buf.toString(/latin/i.test(t.charset || '') ? 'latin1' : 'utf8');
    let rows;
    if (t.format === 'csv') rows = parseCsv(text, t.separator || ',');
    else {
      const tag = name === 'pqrs' ? 'pqr' : name === 'empleados' ? 'empleado' : (text.match(/<(\w+)\b[^>]*\b(?:id|radicado)="/) || [])[1];
      rows = parseXmlRows(text, tag);
      raw[name + '_comments'] = [...text.matchAll(/<!--([\s\S]*?)-->/g)].map(m => m[1]);
    }
    const key = TABLE_KEYS[name] || Object.keys(rows[0] || {})[0];
    for (const r of rows) out.push({ id: `${name}:${r[key]}`, table: name, columns: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '')])) });
    raw[name] = rows;
  }
  return { records: out, raw };
}

export function loadAll(dir) {
  const chats = parseChats(dir);
  const docs = parseDocs(dir);
  const tables = parseTables(dir);
  const rp = [path.join(dir, 'record_index.json'), path.join(dir, '../record_index.json')].find(p => fs.existsSync(p));
  const recordIndex = rp ? readJson(rp) : null;
  return { chats, docs, tables, recordIndex };
}
