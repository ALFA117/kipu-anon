// Anonimizador de texto por spans: detecta, resuelve a qué persona pertenece cada mención
// y la reemplaza por su seudónimo con la misma forma. El resto del texto queda intacto.
import { normMap, norm, digits, escapeRx, styleOf, render, stripAccents } from './text.js';
import { formatLike } from './registry.js';
import { KEEP, SECTOR, CITIES, FEMALE, MALE, SURNAMES } from './catalog.js';
import { COMMON_FIRST, COMMON_SUR } from './names-common.js';

const STREET = '(?:calle|cll|cl|carrerra|carrera|cra|kra|kr|cr|avenida calle|avenida carrera|avenida|av|ak|ac|diagonal|diag|dg|transversal|transv|tv|trans|circular|cq)';
const UNIT = String.raw`(?:\s*(?:apto|apt|apartamento|piso|of|oficina|casa|int|interior|torre|bloque|local|manzana|mz|lote)\.?\s*(?:[a-z]?\d+[a-z]?|[a-z])(?![a-z\d]))*`;
const RX_ADDRESS = new RegExp(`\\b${STREET}\\.?\\s*\\d+\\s?[a-z]?(?:\\s?bis)?(?:\\s?[a-z])?(?:\\s?sur)?\\s*(?:#|no\\.?|n°)\\s*\\d+\\s?[a-z]?\\s*-\\s*\\d+(?:\\s*(?:sur|este))?${UNIT}`
  + `|\\bav(?:enida|\\.)?\\s+(?:el\\s+|la\\s+)?\\p{Lu}\\p{L}+(?:\\s\\p{Lu}\\p{L}+)?\\s*(?:#|no\\.?)?\\s*\\d+\\s?[a-z]?\\s*-\\s*\\d+${UNIT}`, 'giu');
const RX_EMAIL = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const RX_EMAIL_SPOKEN = /\b([a-z0-9][a-z0-9._-]*(?:\s+punto\s+[a-z0-9]+)*)\s+(?:arroba|\(at\)|\[at\])\s+([a-z0-9-]+)((?:\s+(?:punto|dot|\.)\s+[a-z]{2,})+)/gi;
const RX_NUM = /(?<![\p{L}\p{N}\-\/_])(?:\+?57[ -]?)?(?:\d{1,3}(?:[.\s]\d{3}){2,3}|\d{3}[ -]\d{3}[ -]\d{4}|\d{3}[ -]\d{7}|\d{6,12})(?![\p{L}\p{N}\-\/_]|[.,]\d)/gu;
const RX_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
const RX_PLATE = /\b([A-Z]{3})[ -]?(\d{3})\b|\b([A-Z]{3}\d{2}[A-Z])\b/g;
const RX_PASSPORT = /\b([A-Z]{1,2}\d{6,8})\b/g;
const RX_MENTION = /<@([A-Z0-9]+)(?:\|[^>]*)?>/g;
const RX_DOC_CUE = /((?<![a-z])c\.?\s?c\.?(?![a-z])|c[ée]dula|documento|identificaci[oó]n|\bnit\b|\bcc\b|\bid\b|\bc\.?e\.?\b|n[uú]mero de cliente|titular)[^\n\d]{0,25}$/i;
const RX_YEAR_CUE = /(vincul|entr[ée]|ingres[ée]|abr[ií](?!l)|cliente desde|con ustedes|me afili|desde)[^\n.]{0,30}$/i;

export class Anonymizer {
  constructor(reg) {
    this.reg = reg;
    this.keepEnts = new Map();
    this.buildNameIndex();
    const keepSorted = [...KEEP].sort((a, b) => b.length - a.length);
    this.rxKeep = new RegExp(`(?<![a-z0-9])(${keepSorted.map(k => escapeRx(norm(k))).join('|')})(?![a-z0-9])`, 'g');
    this.keepByNorm = new Map(KEEP.map(k => [norm(k), k]));
    // ocupaciones y barrios (cuasi-identificadores)
    const occs = Object.keys(SECTOR).sort((a, b) => b.length - a.length);
    this.rxOcc = new RegExp(`(?<![\\p{L}])(${occs.map(escapeRx).join('|')})(?![\\p{L}])`, 'gu');
    this.barrioCity = new Map();
    for (const e of reg.entities.values()) if (e.barrio && e.city) {
      const k = norm(e.barrio);
      if (!this.barrioCity.has(k)) this.barrioCity.set(k, new Set());
      this.barrioCity.get(k).add(e.city);
    }
    const barrios = [...this.barrioCity.keys()].filter(b => !CITIES.some(c => norm(c) === b)).sort((a, b) => b.length - a.length);
    this.rxBarrio = barrios.length ? new RegExp(`(?<=(?:^|[^a-z])(?:en|barrio|sector|del|de)\\s(?:el\\s|la\\s)?)(${barrios.map(escapeRx).join('|')})(?![a-z0-9])`, 'g') : null;
    // nombres conocidos para detectar terceros no registrados
    this.knownFirst = new Set([...reg.firstNames, ...FEMALE.map(norm), ...MALE.map(norm), ...EXTRA_FIRST, ...COMMON_FIRST]);
    this.knownSur = new Set([...reg.surnameSet, ...SURNAMES.map(norm), ...EXTRA_SUR, ...COMMON_SUR]);
    this.buildLocalIndex();
  }

  /** Usuarios de cada persona (parte del correo antes de la @ y handles de Slack) para links y @menciones. */
  buildLocalIndex() {
    this.localIndex = new Map();
    for (const e of this.reg.entities.values()) {
      for (const m of e.emails) { const l = m.split('@')[0]; if (l.length >= 5) this.localIndex.set(l, { e, email: m }); }
      for (const hd of e.handles) if (hd.length >= 5 && !this.localIndex.has(hd)) this.localIndex.set(hd, { e, handle: hd });
    }
  }

  buildNameIndex() {
    const forms = new Map(); // forma normalizada -> [{e, kind}]
    const add = (f, e, kind) => {
      const k = norm(f).trim().replace(/\s+/g, ' ');
      if (!k || k.length < 3) return;
      if (!forms.has(k)) forms.set(k, []);
      const arr = forms.get(k);
      if (!arr.some(x => x.e === e)) arr.push({ e, kind });
    };
    for (const e of this.reg.entities.values()) {
      if (!e.tokens.length) continue;
      const f = e.first, s = e.surnames;
      add(e.fullName, e, 'full');
      if (s.length) {
        add([...f, s[0]].join(' '), e, 'name');
        if (f.length > 1) add([f[0], s[0]].join(' '), e, 'name');
        if (f.length > 1 && s.length > 1) add([f[0], ...s].join(' '), e, 'name');
        if (f.length > 1) add(f.join(' '), e, 'firsts');
      }
      for (const x of e.extraNames) add(x, e, 'name');
      for (const hd of e.handles) if (/[._]/.test(hd)) add(hd.replace(/[._]/g, ' '), e, 'handle');
    }
    this.forms = forms;
    const keys = [...forms.keys()].sort((a, b) => b.length - a.length);
    const pat = keys.map(k => k.split(' ').map(escapeRx).join('[\\s_.\\-]+')).join('|');
    this.rxNames = new RegExp(`(?<![a-z0-9])(${pat})(?![a-z0-9]|@)`, 'g');
    // índice de nombres de pila y apellidos para resolver en contexto
    this.firstIndex = new Map();
    for (const e of this.reg.entities.values()) if (e.tokens.length) {
      const k = norm(e.first[0]);
      if (!this.firstIndex.has(k)) this.firstIndex.set(k, []);
      this.firstIndex.get(k).push(e);
    }
  }

  /** Agrega las formas de una persona nueva (registros en vivo) al índice de nombres. */
  addForms() { this.buildNameIndex(); this.buildLocalIndex(); }

  /** Renderiza la mención `orig` de la persona e con su seudónimo, token a token. */
  renderName(e, orig) {
    const p = this.reg.pseudo(e);
    const realF = e.first.map(norm), realS = e.surnames.map(norm);
    const toks = norm(orig).split(/[\s_.\-]+/).filter(Boolean);
    const out = [];
    for (const t of toks) {
      let i = realF.indexOf(t);
      if (i >= 0) { out.push(p.first[Math.min(i, p.first.length - 1)]); continue; }
      i = realS.indexOf(t);
      if (i >= 0) { out.push(p.surnames[Math.min(i, 1)]); continue; }
    }
    if (!out.length) out.push(...p.first, p.surnames[0]);
    const uniq = out.filter((x, i) => out.indexOf(x) !== i ? false : true);
    const name = uniq.join(' ');
    return render(name, styleOf(orig));
  }

  /** Puntúa candidatas para una mención ambigua. */
  pick(cands, ctx, start, text) {
    if (cands.length === 1) return cands[0];
    const near = text.slice(Math.max(0, start - 80), start + 120);
    let best = null, bestS = -1;
    for (const e of cands) {
      let s = 0;
      if (ctx.author === e) s += 100;
      if (ctx.linked?.includes(e)) s += 60;
      // radicado PQR o id de transacción en la misma zona apuntan al cliente correcto
      // (pesa más el id más cercano: en una tabla, el de la misma fila)
      const off = Math.max(0, start - 80);
      for (const m of near.matchAll(/PQR-\d{4}-\d{3,5}|TX-\d{4,7}|(?:CL|PG)-\d{4,6}/g)) {
        const cl = /^(?:CL|PG)-/.test(m[0]) ? m[0] : (this.reg.pqrClient?.get(m[0])) || (this.reg.txClient?.get(m[0]));
        if (cl && this.reg.byClient.get(cl) === e) s += Math.max(10, 90 - Math.abs(off + m.index - start) / 2);
      }
      if (ctx.participants?.has(e)) s += 40;
      if (ctx.preferRole && e.role === ctx.preferRole) s += 5;
      // empleado y cliente con el mismo nombre: el contexto inmediato dice cuál es
      const nn = norm(near);
      if (e.role === 'empleado' && /(coordinador|analista|agente|gerente|lider|director|abogad|contador|ingenier|ceo|cto|reporta|equipo de|soporte|nomina|kipupay\.co)/.test(nn)) s += 30;
      if (e.role === 'cliente' && /(cliente|cedula|cc|credito|cuota|mora|saldo|tarjeta|cl-\d)/.test(nn)) s += 30;
      if (s > bestS) { best = e; bestS = s; }
    }
    return best;
  }

  touch(e, recId, orig, type, value) {
    if (!e) return;
    if (recId) e.records.add(recId);
    if (orig) e.originals.add(orig);
    if (type && value) {
      if (type === 'name') e.usedNames.add(value);
      else if (!e.used[type]) e.used[type] = value;
    }
  }

  ctxPerson(ctx) {
    if (ctx.author && ctx.author.role === 'cliente') return ctx.author;
    if (ctx.linked?.length === 1) return ctx.linked[0];
    if (ctx.threadClients?.length === 1) return ctx.threadClients[0];
    return null;
  }

  /**
   * ctx: { recId, author, participants:Set, linked:[Entity], threadClients:[Entity], quasi:boolean }
   */
  text(text, ctx = {}) {
    if (!text) return text;
    this.curText = text;
    this.curIntro = null; // persona que se presenta en este texto ("me llamo X"): dueña de los datos nuevos
    const { s: n, map } = normMap(text);
    const spans = [];
    const push = (ns, ne, prio, fn, isNorm = true) => {
      const start = isNorm ? map[ns] : ns;
      const end = isNorm ? map[ne - 1] + (text.codePointAt(map[ne - 1]) > 0xffff ? 2 : 1) : ne;
      spans.push({ start, end, prio, fn });
    };
    const reg = this.reg;
    const recId = ctx.recId;

    // 1. conservados (bancos, marcas, lugares, figuras públicas): protegen su span
    for (const m of n.matchAll(this.rxKeep)) {
      push(m.index, m.index + m[0].length, 1, null);
      const k = this.keepByNorm.get(m[0]);
      if (k) { if (!this.keepEnts.has(k)) this.keepEnts.set(k, new Set()); if (recId) this.keepEnts.get(k).add(recId); }
    }

    // 2. correos (normales y deletreados)
    for (const m of text.matchAll(RX_EMAIL)) {
      const orig = m[0];
      push(m.index, m.index + orig.length, 9, () => {
        const e = reg.byEmail.get(orig.toLowerCase()) || this.ownerForUnknown(ctx, 'email', orig);
        const v = reg.pseudoEmail(e, orig);
        this.touch(e, recId, orig, 'email', v);
        return /[A-Z]/.test(orig) && orig === orig.toUpperCase() ? v.toUpperCase() : v;
      }, false);
    }
    for (const m of text.matchAll(RX_EMAIL_SPOKEN)) {
      const orig = m[0];
      const local = m[1].replace(/\s+punto\s+/gi, '.');
      const domain = m[2] + m[3].replace(/\s+(?:punto|dot|\.)\s+/gi, '.');
      const real = `${local}@${domain}`.toLowerCase();
      push(m.index, m.index + orig.length, 9, () => {
        const e = reg.byEmail.get(real) || this.ownerForUnknown(ctx, 'email', real);
        const v = reg.pseudoEmail(e, real);
        this.touch(e, recId, orig);
        this.touch(e, null, real);
        const [pl, pd] = v.split('@');
        return `${pl.replace(/\./g, ' punto ')} arroba ${pd.replace(/\./g, ' punto ')}`;
      }, false);
    }

    // 2c. usuarios sueltos: ?u=khenao, ?ref=agomez, @arojas, "usuario jcastro" (sin @dominio)
    for (const m of text.matchAll(/(?<![A-Za-z0-9._%+-])([a-z][a-z0-9._]{3,})(?![A-Za-z0-9_]|@|\.[a-z]{2,}\b)/g)) {
      const hit = this.localIndex.get(m[1]);
      if (!hit) continue;
      const orig = m[1];
      push(m.index, m.index + orig.length, 6, () => {
        const v = hit.email ? reg.pseudoEmail(hit.e, hit.email).split('@')[0] : reg.pseudoHandle(hit.e, orig);
        this.touch(hit.e, recId, orig);
        return v;
      }, false);
    }

    // 2c-bis. usuario suelto que arranca con un nombre de pila y trae número, punto o guion bajo: beatrizsalas8, oscar_romo
    // también inicial(es) + apellido: sgomez19, c.valencia2023, jemartinez
    for (const m of text.matchAll(/(?<![\p{L}\p{N}._%+@\/-])([a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)(?![\p{L}\p{N}_@]|\.[a-z]|-\p{L})/gu)) {
      const tok = m[1];
      if (tok.length < 5 || this.localIndex.get(tok)) continue;
      const t = tok.replace(/[\d._-]/g, '');
      const marked = /[\d_.\-]/.test(tok);
      let first = 0;
      for (let k = 4; k <= t.length && !first; k++) {
        const f = t.slice(0, k);
        if (this.knownFirst.has(f) && (!STAFF_WORDS.has(f) || t.length > k + 2)) first = k;
      }
      let ok = marked && first && (t.length - first >= 2 || /\d/.test(tok));
      // inicial(es) + apellido de 5+ letras ("sgomez19", "jemartinez"); el apellido solo no basta
      if (!ok && marked) for (let k = 1; k <= 2 && !ok; k++) ok = t.length - k >= 5 && this.knownSur.has(t.slice(k)) && !this.knownSur.has(t) && !this.knownFirst.has(t);
      if (!ok) continue;
      push(m.index, m.index + tok.length, 5, () => {
        const e = this.ctxPerson(ctx) || reg.newValueEntity('usuario', tok);
        const base = reg.pseudoHandle(e, tok.includes('.') ? 'a.b' : tok.includes('_') ? 'a_b' : 'ab');
        const tail = (tok.match(/\d+$/) || [''])[0];
        this.touch(e, recId, tok);
        return base + (tail ? fakeFrom(e.key + tok, tail.padStart(2, '1')).slice(0, tail.length) : '');
      }, false);
    }

    // 2d. usuario tras una pista: "mi usuario es juan123", "user id is user789", "login: l.torres"
    const TOK = String.raw`['"‘’]?@?([\p{L}][\p{L}\d_.\-]{2,}[\p{L}\d])(?![\p{L}\d_@])`;
    for (const m0 of text.matchAll(new RegExp(String.raw`\b(?:usuarios?|user(?:name|s|\s?id)?|login|alias|nick(?:name)?|handle|[Mm]i cuenta|cuenta)\b(?:\s+(?:(?:de|desde|en|para)\s+\p{Lu}\p{L}+|es|era|fue|is|was|para ingresar|de acceso|anterior|viejo|nuevo|:|=))*\s*[:=]?\s*` + TOK, 'giu'))) {
      // listas: "usuarios: carlosg23 y c.guerrero", "el usuario l.patricia y también lpatricia23"
      const found = [{ tok: m0[1], start: m0.index + m0[0].lastIndexOf(m0[1]) }];
      let pos = m0.index + m0[0].length;
      for (let mm; (mm = text.slice(pos).match(new RegExp(String.raw`^(?:\s*,\s*|\s+(?:y|o|and|or)\s+(?:tambi[eé]n\s+|el\s+)?)` + TOK, 'u'))) && /[\d_.\-]/.test(mm[1]);) {
        found.push({ tok: mm[1], start: pos + mm[0].lastIndexOf(mm[1]) });
        pos += mm[0].length;
      }
      for (const { tok, start } of found) {
      if (/^(?:CL|TX|PQR|KP|INC)-/i.test(tok)) continue;
      if (/^(es|is|de|el|la|y|o|era|fue|incorrect[oa]?|correct[oa]?|bloquead[oa]|nuevo|registrad[oa]|and|or|the|para|desde|asignad[oa]|llamad[oa]|diferente|distinto)$/i.test(tok)) continue;
      // sin dígitos, puntos ni guiones solo cuenta si empieza con un nombre o apellido conocido (carlosram, clararuiz)
      if (!/[\d_.\-]/.test(tok)) {
        const t = norm(tok);
        let hit = false;
        for (let k = 4; k <= t.length && !hit; k++) hit = this.knownFirst.has(t.slice(0, k)) || this.knownSur.has(t.slice(0, k));
        if (!hit) continue;
      }
      push(start, start + tok.length, 6, () => {
        const known = this.localIndex.get(tok.toLowerCase());
        const e = known?.e || this.ctxPerson(ctx) || reg.newValueEntity('usuario', tok);
        const base = known?.email ? reg.pseudoEmail(e, known.email).split('@')[0] : reg.pseudoHandle(e, tok.includes('.') ? 'a.b' : tok.includes('_') ? 'a_b' : 'ab');
        const tail = (tok.match(/\d+$/) || [''])[0];
        const v = base + (tail ? fakeFrom(e.key + tok, tail.padStart(2, '1')).slice(0, tail.length) : '');
        this.touch(e, recId, tok);
        return v;
      }, false);
      }
    }

    // 2e. cédula tras pista con separadores raros: "987.654.321-0", "123-456-789", "12.345.67.89", "123456-78"
    // (sin NIT: es de empresas; y el número no puede ser parte de un id como TX-123456)
    for (const m of text.matchAll(/(c[ée]dula|\bcc\b|c\.c\.|documento|identificaci[oó]n|\bid\b|\bc\.?e\.?\b|\bdni\b|\bpep\b|\bppt\b|extranjer[ií]a|permiso)[^\d\n]{0,30}?(?<![\p{L}\d\-])(\d(?:[\d.\-]|\s(?=\d))*\d)(?![\d.\-]?\d)/giu)) {
      const orig = m[2];
      const d = digits(orig);
      if (d.length < 6 || d.length > 12) continue;
      // NIT de empresa (900.123.456-7) o "tax ID": no es una persona
      if (/(tax|nit)\s*$/i.test(text.slice(Math.max(0, m.index - 6), m.index))) continue;
      const start = m.index + m[0].length - orig.length;
      push(start, start + orig.length, 7, () => {
        const e = reg.byCedula.get(d) || this.ownerForUnknown(ctx, 'cedula', d);
        const v = e.cedulas.has(d) && [...e.cedulas][0] === d ? reg.pseudo(e).cedula : fakeFrom(e.key + d, d);
        this.touch(e, recId, orig, null);
        return formatLike(v.slice(0, d.length).padEnd(d.length, '7'), orig);
      }, false);
    }

    // 2f. fecha de nacimiento en otros formatos tras pista: 12-08-1990, 2000/11/10, 1987.04.15, DOB 05-01-1994
    for (const m of text.matchAll(/(naci|nac[ií]|nacimiento|\bdob\b|born|birth|cumpleaños)[^\n\d]{0,30}?(\d{1,4})([\/\-.])(\d{1,2})\3(\d{2,4})/giu)) {
      const [g1, sep, g2, g3] = [m[2], m[3], m[4], m[5]];
      const ymd = g1.length === 4;
      const y = ymd ? g1 : g3;
      if (y.length !== 4 || +y > 2008 || +y < 1930) continue;
      const iso = ymd ? `${y}-${g2.padStart(2, '0')}-${g3.padStart(2, '0')}` : `${y}-${g2.padStart(2, '0')}-${g1.padStart(2, '0')}`;
      const orig = `${g1}${sep}${g2}${sep}${g3}`;
      const start = m.index + m[0].length - orig.length;
      push(start, start + orig.length, 8, () => {
        let e = reg.byBirth.get(iso);
        if (!e) { e = this.ownerForUnknown(ctx, 'birth', iso); reg.byBirth.set(iso, e); e.births.add(iso); }
        const [ny, nm, nd] = (e.births.size <= 1 && [...e.births][0] === iso ? reg.pseudo(e).birth : fakeBirthFrom(e.key + iso)).split('-');
        this.touch(e, recId, orig);
        return ymd ? `${ny}${sep}${nm.padStart(g2.length, '0')}${sep}${nd.padStart(g3.length, '0')}` : `${nd.padStart(g1.length, '0')}${sep}${nm.padStart(g2.length, '0')}${sep}${ny}`;
      }, false);
    }

    // 2h. celular escrito con espacios entre dígitos ("3 1 0 4 4 4 4 4 4", "3 10 11 22 33") o en palabras ("tres uno cero…")
    for (const m of text.matchAll(/(celular|\bcel\b|tel[ée]fono|\btel\b|whatsapp|m[óo]vil|n[uú]mero|phone|llamar al|llámenme al)[^\d\n]{0,25}?(?<![\d])(3(?:\s?\d){6,9})(?!\d)/giu)) {
      const orig = m[2];
      const d = digits(orig);
      if (d.length < 7 || !/\s/.test(orig)) continue;
      const start = m.index + m[0].length - orig.length;
      push(start, start + orig.length, 7, () => {
        const e = reg.byPhone.get(d) || this.ownerForUnknown(ctx, 'phone', d);
        const v = '3' + fakeFrom(e.key + d, d).slice(1);
        this.touch(e, recId, orig);
        return formatLike(v, orig);
      }, false);
    }
    const NUMW = { cero: 0, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
    for (const m of text.matchAll(/\b(?:cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)(?:[\s.,…\-]+(?:cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)){5,}\b/giu)) {
      const words = m[0].match(/[a-zñ]+/giu);
      const d = words.map(w => NUMW[w.toLowerCase()]).join('');
      push(m.index, m.index + m[0].length, 7, () => {
        const e = reg.byPhone.get(d) || reg.byCedula.get(d) || this.ownerForUnknown(ctx, /^3/.test(d) ? 'phone' : 'cedula', d);
        const fake = fakeFrom(e.key + 'w' + d, d.padEnd(7, '0'));
        const names = Object.keys(NUMW).filter(k => k !== 'una');
        let i = 0;
        this.touch(e, recId, null);
        return m[0].replace(/[a-zñ]+/giu, w => { const n = names[+fake[i++ % fake.length]]; return w[0] === w[0].toUpperCase() ? n[0].toUpperCase() + n.slice(1) : n; });
      }, false);
    }

    // 2i. lugares de vivienda con nombre propio: vereda, finca, conjunto, urbanización, edificio, torre
    for (const m of text.matchAll(/\b(vereda|finca|hacienda|conjunto(?: residencial)?|urbanizaci[óo]n|edificio|torre)\s+((?:\p{Lu}\p{Ll}+|del?|la|los|las)(?:\s+(?:\p{Lu}\p{Ll}+|del?|la|los|las))*(?:\s+\p{Lu}\p{Ll}+)?)/gu)) {
      const name = m[2].replace(/\s+(del?|la|los|las)$/u, '');
      if (!/\p{Lu}/u.test(name[0])) continue;
      const start = m.index + m[0].indexOf(m[2]);
      push(start, start + name.length, 5, () => {
        const opts = ['El Recreo', 'La Esmeralda', 'Los Pinos', 'San Rafael', 'Villa Clara', 'El Mirador', 'Las Acacias', 'La Pradera', 'Altos del Bosque', 'El Retiro', 'Santa Elena', 'La Floresta'];
        const hh = crypto.createHash('sha256').update('lugar|' + name).digest()[0];
        return opts[hh % opts.length];
      }, false);
    }

    // 2g. cuentas y tarjetas sin separadores: "account number is 5544332211", "tarjeta que termina en 1234"
    for (const m of text.matchAll(/\b(?:cuenta|account|acct)(?:\s+(?:de ahorros|corriente|bancaria|number|n[uú]mero|no\.?|#))*\s*(?:es|is|:|#)?\s*(\d{6,20})\b|\b(?:termina(?:da)? en|ending in|últimos (?:4|cuatro) (?:dígitos )?(?:de (?:la|mi) tarjeta )?(?:son|es)?)\s*(\d{4})\b/giu)) {
      const orig = m[1] || m[2];
      if (!orig || reg.byPhone.get(orig) || reg.byCedula.get(orig)) continue;
      const start = m.index + m[0].length - orig.length;
      push(start, start + orig.length, 7, () => {
        const e = this.ownerForUnknown(ctx, 'account', orig);
        const v = fakeFrom(e.key + 'acct' + orig, orig);
        this.touch(e, recId, orig.length >= 6 ? orig : null); // 4 dígitos sueltos no se declaran: aparecen en cualquier id
        return v;
      }, false);
    }

    // 3. menciones de Slack <@UID>
    for (const m of text.matchAll(RX_MENTION)) {
      push(m.index, m.index + m[0].length, 9, () => {
        // un uid que no está en el export también es una persona: recibe su propio seudónimo estable
        let e = reg.byUid.get(m[1]);
        if (!e) { e = reg.newValueEntity('uid', m[1]); reg.byUid.set(m[1], e); }
        const p = reg.pseudo(e);
        const v = `${p.first[0]} ${p.surnames[0]}`;
        this.touch(e, recId, null, 'name', v);
        return `@${v}`;
      }, false);
    }

    // 4. direcciones
    for (const m of text.matchAll(RX_ADDRESS)) {
      const orig = m[0];
      push(m.index, m.index + orig.length, 8, () => {
        const e = reg.byAddress.get(norm(orig)) || this.ownerForUnknown(ctx, 'address', orig);
        const p = reg.pseudo(e);
        this.touch(e, recId, orig, 'address', p.address);
        return p.address;
      }, false);
    }

    // 5. números: cédulas y celulares (conocidos en cualquier formato; desconocidos con contexto)
    for (const m of text.matchAll(RX_NUM)) {
      const orig = m[0];
      let d = digits(orig);
      const d10 = d.length === 12 && d.startsWith('57') ? d.slice(2) : d;
      let e = reg.byCedula.get(d) || null;
      let type = e ? 'cedula' : null;
      if (!e && reg.byPhone.get(d10)) { e = reg.byPhone.get(d10); type = 'phone'; }
      const before = text.slice(Math.max(0, m.index - 40), m.index);
      if (!e) {
        if (/^3\d{9}$/.test(d10)) { type = 'phone'; }
        else if (d.length >= 6 && d.length <= 10 && RX_DOC_CUE.test(before)) { type = 'cedula'; }
        // segundo número de una lista de cédulas: "cédula: 1122993344 y 1122993345"
        else if (d.length >= 6 && d.length <= 10 && /(c[ée]dulas?|documentos?|\bcc\b)[^\n]{0,40}?\d[\d.\- ]{4,}\d\s*(?:,|y|o|\/)\s*$/i.test(text.slice(Math.max(0, m.index - 70), m.index))) { type = 'cedula'; }
        else continue;
      }
      const known = e, tt = type;
      push(m.index, m.index + orig.length, 8, () => {
        // el dueño de un dato nuevo se decide al reemplazar: así puede ser quien se presentó antes en el texto
        const ee = known || reg.byCedula.get(d) || reg.byPhone.get(d10) || this.ownerForUnknown(ctx, tt, d10);
        const p = reg.pseudo(ee);
        let v = tt === 'cedula' ? p.cedula : p.phone;
        if (tt === 'cedula' && v.length !== d.length) v = (v + v).slice(0, d.length);
        if (tt === 'cedula' && reg.byCedula.get(d) !== ee && !ee.cedulas.has(d)) v = fakeFrom(ee.key + d, d);
        if (tt === 'phone' && !ee.phones.has(d10)) v = '3' + fakeFrom(ee.key + d10, d10).slice(1);
        this.touch(ee, recId, orig, tt, v);
        this.touch(ee, null, d10);
        return formatLike(v, orig);
      }, false);
    }

    // 5b. cédulas/celulares conocidos pegados a letras o guiones bajos (nombres de archivo: CC1022649507_x.pdf)
    for (const m of text.matchAll(/(?<!\d)\d{7,12}(?!\d)/g)) {
      const d = m[0];
      const e = reg.byCedula.get(d) || reg.byPhone.get(d);
      if (!e) continue;
      const tt = reg.byCedula.get(d) ? 'cedula' : 'phone';
      push(m.index, m.index + d.length, 6, () => {
        const p = reg.pseudo(e);
        const v = tt === 'cedula' ? (e.cedulas.has(d) && [...e.cedulas][0] === d ? p.cedula : fakeFrom(e.key + d, d)) : (e.phones.has(d) ? p.phone : '3' + fakeFrom(e.key + d, d).slice(1));
        this.touch(e, recId, d, null);
        return v;
      }, false);
    }

    // 6. fechas de nacimiento: ISO, d/m/a, m/d/a y "4 de marzo de 1979". Una fecha conocida del
    // registro siempre; una desconocida solo si el año es de nacimiento (≤ 2008), no de transacción.
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const dates = [];
    for (const m of text.matchAll(RX_DATE)) {
      if (m[1]) dates.push({ m, iso: `${m[1]}-${m[2]}-${m[3]}`, fmt: 'iso' });
      else {
        const a = +m[4], b = +m[5], y = m[6];
        const dmy = `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
        const mdy = `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
        if (reg.byBirth.get(mdy) && !reg.byBirth.get(dmy)) dates.push({ m, iso: mdy, fmt: 'mdy' });
        else dates.push({ m, iso: b > 12 ? mdy : dmy, fmt: b > 12 ? 'mdy' : 'dmy' });
      }
    }
    for (const m of text.matchAll(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de|del)\s+(\d{4})\b/gi)) {
      const mo = MESES.indexOf(m[2].toLowerCase().replace('setiembre', 'septiembre')) + 1;
      dates.push({ m, iso: `${m[3]}-${String(mo).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`, fmt: 'long' });
    }
    for (const { m, iso, fmt } of dates) {
      let e = reg.byBirth.get(iso);
      if (!e && !(+iso.slice(0, 4) <= 2008 && +iso.slice(0, 4) >= 1930)) continue;
      push(m.index, m.index + m[0].length, 8, () => {
        if (!e) { e = this.ownerForUnknown(ctx, 'birth', iso); reg.byBirth.set(iso, e); e.births.add(iso); }
        const p = reg.pseudo(e);
        const known = [...e.births][0] === iso || reg.byBirth.get(iso) === e;
        const v = known && e.births.size <= 1 ? p.birth : fakeBirthFrom(e.key + iso);
        this.touch(e, recId, m[0], fmt === 'iso' ? 'birth_iso' : null, fmt === 'iso' ? v : null);
        this.touch(e, null, iso);
        const [y, mo, da] = v.split('-');
        if (fmt === 'iso') return v;
        if (fmt === 'dmy') return `${String(+da).padStart(m[4].length, '0')}/${String(+mo).padStart(m[5].length, '0')}/${y}`;
        if (fmt === 'mdy') return `${String(+mo).padStart(m[4].length, '0')}/${String(+da).padStart(m[5].length, '0')}/${y}`;
        return `${+da} de ${MESES[+mo - 1]} de ${y}`;
      }, false);
    }

    // 6b. verificación de identidad: "últimos 4" de la cédula o del celular de alguien del contexto
    const ctxAll = [ctx.author, ...(ctx.linked || []), ...(ctx.participants || [])].filter(Boolean);
    for (const m of text.matchAll(/(?<![\d.,\-\/])(\d{4})(?![\d.,\-\/])/g)) {
      const d = m[1];
      if (/^(19|20)\d\d$/.test(d) && !ctxAll.some(e => [...e.cedulas, ...e.phones].some(x => x.endsWith(d)))) continue;
      let hit = null, kind = null;
      for (const e of ctxAll) {
        if ([...e.cedulas].some(c => c.endsWith(d))) { hit = e; kind = 'cedula'; break; }
        if ([...e.phones].some(c => c.endsWith(d))) { hit = e; kind = 'phone'; break; }
      }
      if (!hit) continue;
      const ee = hit, kk = kind;
      push(m.index, m.index + 4, 7, () => {
        const p = reg.pseudo(ee);
        this.touch(ee, recId, null);
        return (kk === 'cedula' ? p.cedula : p.phone).slice(-4);
      }, false);
    }

    // 6c. números de cuenta o tarjeta con contexto
    for (const m of text.matchAll(/(?<![\w-])(\d{2,6}(?:[ -]\d{1,8}){1,4})(?![\w-])/g)) {
      const before = text.slice(Math.max(0, m.index - 45), m.index);
      if (!/(cuenta|account|tarjeta|card|ahorros|corriente|n[uú]mero de (?:la )?(?:cuenta|tarjeta))/i.test(before)) continue;
      const d = digits(m[0]);
      if (d.length < 8 || reg.byPhone.get(d) || reg.byCedula.get(d)) continue;
      // una fecha no es una cuenta: "bloqueo desde el 2026-10-07"
      if (/^(?:19|20)\d\d-[01]\d-[0-3]\d$|^[0-3]?\d-[01]?\d-(?:19|20)\d\d$/.test(m[0])) continue;
      push(m.index, m.index + m[0].length, 7, () => {
        const e = this.ownerForUnknown(ctx, 'account', d);
        const v = fakeFrom(e.key + 'acct' + d, d);
        this.touch(e, recId, m[0], 'account', formatLike(v, m[0]));
        return formatLike(v, m[0]);
      }, false);
    }

    // 7. placas y pasaportes (con contexto)
    for (const m of text.matchAll(/(?<![A-Za-z0-9])([A-Z]{3})[ -]?(\d{3})(?![0-9])|(?<![A-Za-z0-9])([A-Z]{3}\d{2}[A-Z])(?![A-Za-z0-9])/g)) {
      const orig = m[0];
      const key = orig.replace(/[ -]/g, '');
      const before = text.slice(Math.max(0, m.index - 60), m.index);
      if (!reg.byPlate.has(key) && !orig.includes('-') && !/placa|veh[ií]culo|carro|moto|camioneta|soat|car|plate|license/i.test(before) && !(ctx.filename && /soat|placa|tarjeta_propiedad/i.test(text))) continue;
      push(m.index, m.index + orig.length, 8, () => {
        let e = reg.byPlate.get(key);
        if (!e) { e = this.ownerForUnknown(ctx, 'plate', key); reg.byPlate.set(key, e); }
        e.plates.add(key);
        const v = fakePlateFrom(key);
        const shown = orig.includes('-') ? v.slice(0, 3) + '-' + v.slice(3) : orig.includes(' ') ? v.slice(0, 3) + ' ' + v.slice(3) : v;
        this.touch(e, recId, orig, 'plate', shown);
        this.touch(e, null, key);
        return shown;
      }, false);
    }
    for (const m of text.matchAll(RX_PASSPORT)) {
      const before = text.slice(Math.max(0, m.index - 40), m.index);
      if (!/pasaporte|passport/i.test(before)) continue;
      push(m.index, m.index + m[0].length, 8, () => {
        let e = reg.byPassport.get(m[0]);
        if (!e) { e = this.ownerForUnknown(ctx, 'passport', m[0]); reg.byPassport.set(m[0], e); }
        const v = fakePassportFrom(m[0]);
        this.touch(e, recId, m[0], 'passport', v);
        return v;
      }, false);
    }

    // 8. nombres del registro (todas sus formas, sin tildes, mayúsculas, nombre_apellido)
    for (const m of n.matchAll(this.rxNames)) {
      const key = m[0].replace(/[\s_.\-]+/g, ' ');
      const cands = this.forms.get(key);
      if (!cands) continue;
      const ns = m.index, ne = m.index + m[0].length;
      push(ns, ne, 7, () => {
        const origText = text.slice(map[ns], map[ne - 1] + 1);
        const e = this.pick(cands.map(c => c.e), ctx, map[ns], text);
        const v = this.renderName(e, origText);
        this.touch(e, recId, origText, /[_.]/.test(v) ? null : 'name', titleOf(v));
        return v;
      });
    }

    // 8b. inicial + apellido ("A. Marulanda", "G. Londoño"): la persona del registro con esa inicial y ese apellido
    for (const m of text.matchAll(/(?<![\p{L}\p{N}])(\p{Lu})\.\s?(\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?)(?![\p{L}])/gu)) {
      const ini = norm(m[1]);
      const surToks = m[2].split(/\s+/);
      const s1 = norm(surToks[0]);
      if (!this.knownSur.has(s1)) continue;
      const cands = [...reg.entities.values()].filter(e => e.tokens.length && norm(e.first[0])[0] === ini && e.surnames.length && norm(e.surnames[0]) === s1);
      const orig = m[0];
      push(m.index, m.index + orig.length, 7, () => {
        const e = cands.length ? this.pick(cands, ctx, m.index, text) : reg.newTercero(`${m[1]}. ${m[2]}`);
        const p = reg.pseudo(e);
        const v = `${stripAccents(p.first[0])[0].toUpperCase()}. ${surToks.length > 1 ? p.surnames.join(' ') : p.surnames[0]}`;
        this.touch(e, recId, orig);
        return v;
      }, false);
    }

    // 9. nombre de pila suelto o "señor Apellido" de personas en contexto
    const ctxPeople = new Set([ctx.author, ...(ctx.linked || []), ...(ctx.participants || []), ...(ctx.threadClients || [])].filter(Boolean));
    // en texto interno (lo escribe un empleado o es un documento) los nombres de pila sueltos suelen ser colegas
    const internal = ctx.internal || ctx.author?.role === 'empleado';
    if (ctxPeople.size || internal) {
      for (const m of n.matchAll(/(?<![a-z0-9@._-])([a-z]{3,})(?![a-z0-9@_-]|\.[a-z])/g)) {
        const tok = m[1];
        let hits = [...ctxPeople].filter(e => e.tokens.length && e.first.some(f => norm(f) === tok));
        if (!hits.length && internal && !STAFF_WORDS.has(tok)) {
          const after = n.slice(m.index + tok.length, m.index + tok.length + 2);
          // "Juan Valdez", "Kipu Pay": si sigue otra palabra con mayúscula que no es su apellido, no es este colega
          const nextWord = text.slice(map[m.index + tok.length - 1] + 1).match(/^\s+(\p{Lu}\p{L}+)/u)?.[1];
          hits = (this.firstIndex.get(tok) || []).filter(e => e.role === 'empleado' && (!nextWord || e.surnames.some(s => norm(s) === norm(nextWord))));
          void after;
        }
        // apodo del autor al firmar: "un abrazo, Juli" (Juliana), "Pipe" (apodo de su perfil)
        if (!hits.length && ctx.author?.tokens.length) {
          const fa = norm(ctx.author.first[0]);
          if ((tok.length >= 3 && tok.length < fa.length && fa.startsWith(tok)) || ctx.author.nicknames?.has(tok)) hits = [ctx.author];
        }
        let e = null;
        if (hits.length) e = this.pick(hits, ctx, map[m.index], text);
        else {
          const before = n.slice(Math.max(0, m.index - 16), m.index);
          // tratamiento o cargo + apellido: "señor Mejía", "el agente Zapata", "la asesora Ruiz"
          if (/\b(senor|senora|sr\.?|sra\.?|don|dona|doctor|doctora|dr\.?|dra\.?|ing\.?|ingenier[oa]|lic\.?|licenciad[oa]|agente|asesor|asesora|analista|gerente|coordinador|coordinadora|colega|companer[oa]|profesor|profesora|cliente|clienta)\s$/.test(before)) {
            const sh = [...ctxPeople].filter(x => x.surnames.some(s => norm(s) === tok));
            if (sh.length) e = this.pick(sh, ctx, map[m.index], text);
          }
        }
        if (!e) continue;
        const orig = text.slice(map[m.index], map[m.index + tok.length - 1] + 1);
        if (!/^\p{Lu}/u.test(orig)) continue; // solo nombres propios
        const ee = e;
        push(m.index, m.index + tok.length, 5, () => {
          const v = this.renderName(ee, orig);
          this.touch(ee, recId, orig, 'name', titleOf(v));
          return v;
        });
      }
    }

    // 10. terceros no registrados: Nombre (Nombre) Apellido (Apellido) en texto libre
    for (const m0 of text.matchAll(/(?<![\p{L}\p{N}_@.])(\p{Lu}[\p{L}]+(?:\s+\p{Lu}[\p{L}]+){1,4})(?![\p{L}\p{N}_@])/gu)) {
      // "Estimado Carlos Sánchez", "Hola Laura Martínez": se salta lo que va antes del primer nombre de pila
      const all = m0[1].split(/\s+/);
      let j = 0;
      while (j < all.length - 1 && !this.knownFirst.has(norm(all[j]))) j++;
      if (j >= all.length - 1) continue;
      let off = 0;
      for (let q = 0; q < j; q++) off = m0[1].indexOf(all[q + 1], off + all[q].length);
      const m = { index: m0.index + off, 1: m0[1].slice(off) };
      const toks = m[1].split(/\s+/);
      const nt = toks.map(t => norm(t));
      if (!this.knownFirst.has(nt[0])) continue;
      if (m.index > 0 && /(san|santa|plaza|parque|calle|carrera|avenida|barrio|colegio|universidad|banco|hospital|clinica|clínica)\s$/i.test(text.slice(Math.max(0, m.index - 12), m.index))) continue;
      let end = 1;
      while (end < toks.length && this.knownFirst.has(nt[end]) && !this.knownSur.has(nt[end])) end++;
      let se = end;
      while (se < toks.length && se < end + 2 && this.knownSur.has(nt[se])) se++;
      // nombre de pila conocido + dos palabras con mayúscula = nombre y dos apellidos, aunque no estén en la lista
      // (solo dentro de la misma línea: en una firma, la línea siguiente es el cargo, no un apellido)
      const seg = (m[1].match(new RegExp(`^(?:\\S+\\s+){${end + 1}}\\S+`)) || [''])[0];
      if (se === end && toks.length >= end + 2 && !seg.includes('\n') && (!STAFF_WORDS.has(nt[0]) || end >= 2) && !KEEP.some(k => norm(m[1]).includes(norm(k)))) se = end + 2;
      // nombre(s) de pila + un apellido fuera de catálogo en la misma línea ("Sandra Milena Quiroz", "Camilo Reyes")
      const seg1 = (m[1].match(new RegExp(`^(?:\\S+\\s+){${end}}\\S+`)) || [''])[0];
      if (se === end && toks.length > end && !seg1.includes('\n') && nt[end].length >= 3 && !NOT_SURNAME.has(nt[end])
        && !CITY_N.has(nt[end]) && (!STAFF_WORDS.has(nt[0]) || end >= 2) && !KEEP.some(k => norm(k).split(' ').includes(nt[end]) || norm(m[1]).startsWith(norm(k)))) se = end + 1;
      if (se === end) continue;
      const full = toks.slice(0, se).join(' ');
      if (this.forms.has(norm(full))) continue; // ya lo cubre el registro
      if (KEEP.some(k => norm(k) === norm(full))) continue;
      const start = m.index, stop = m.index + full.length;
      push(start, stop, 4, () => {
        const e = reg.newTercero(full);
        e.firstCount = end;
        const v = this.renderName(e, full);
        this.touch(e, recId, full, 'name', titleOf(v));
        return v;
      }, false);
    }

    // 10-inicial. nombre de pila + inicial + apellido: "Diego F. Ríos", "Claudia M. Rodríguez", "Daniel H. Maldonado"
    for (const m0 of text.matchAll(/(?<![\p{L}\p{N}_@.])((?:\p{Lu}\p{Ll}+[ \t]+){1,3})\p{Lu}\.[ \t]*(\p{Lu}\p{Ll}{2,}(?:[ \t]+\p{Lu}\p{Ll}{2,})?)(?![\p{L}\p{N}_@])/gu)) {
      // se saltan saludos y tratamientos antes del nombre de pila ("Hola Diego F. Ríos")
      const pre = m0[1].trim().split(/[ \t]+/);
      const j = pre.findIndex(w => this.knownFirst.has(norm(w)));
      if (j < 0 || NOT_SURNAME.has(norm(m0[2].split(/\s+/)[0])) || CITY_N.has(norm(m0[2].split(/\s+/)[0]))) continue;
      const skip = m0[0].indexOf(pre[j]);
      const m = { index: m0.index + skip, 0: m0[0].slice(skip), 1: pre.slice(j).join(' '), 2: m0[2] };
      const full = m[0];
      if (this.forms.has(norm(full))) continue;
      push(m.index, m.index + full.length, 4, () => {
        const e = reg.newTercero(`${m[1]} ${m[2]}`);
        e.firstCount = m[1].split(/\s+/).length;
        const v = this.renderName(e, `${m[1]} ${m[2]}`);
        this.touch(e, recId, full, 'name', titleOf(v));
        const w = v.split(' ');
        return `${w.slice(0, e.firstCount).join(' ')} ${w[e.firstCount][0]}. ${w.slice(e.firstCount + 1).join(' ') || w[e.firstCount]}`.trim();
      }, false);
    }

    // 10-inicial-final. nombre de pila + inicial del apellido: "Lina M.", "Oscar C." (informes que abrevian)
    for (const m of text.matchAll(/(?<![\p{L}\p{N}_@.])(\p{Lu}\p{Ll}{2,})[ \t]+(\p{Lu})\.(?![ \t]*\p{Lu}\p{Ll})(?!\p{L})/gu)) {
      const f = norm(m[1]);
      if (!this.knownFirst.has(f) || STAFF_WORDS.has(f) || NOT_SURNAME.has(f)) continue;
      push(m.index, m.index + m[0].length, 4, () => {
        // la persona del registro con ese nombre y esa inicial, si es una sola; si no, un tercero
        const same = (this.firstIndex.get(f) || []).filter(x => norm(x.surnames[0] || '')[0] === norm(m[2]));
        const e = same.length === 1 ? same[0] : this.ctxPerson(ctx)?.first.some(x => norm(x) === f) ? this.ctxPerson(ctx) : reg.newTercero(`${m[1]} ${m[2]}`);
        const p = reg.pseudo(e);
        const v = `${p.first[0]} ${p.surnames[0][0]}.`;
        this.touch(e, recId, m[0], 'name', v);
        return v;
      }, false);
    }

    // 10-tabla. tablas markdown: la columna dice qué es cada celda ("| Cédula |", "| Usuario |", "| Nombre |")
    for (const tb of text.matchAll(/^\|(.+)\|[ \t]*\r?\n\|[ \t:|-]+\|[ \t]*\r?\n((?:\|.*\|[ \t]*(?:\r?\n|$))+)/gm)) {
      const heads = tb[1].split('|').map(h => norm(h.replace(/\*/g, '')).trim());
      const kinds = heads.map(h => /nombre|cliente|titular|deudor|codeudor|responsable|agente|asesor/.test(h) && !/id|codigo|cod\b/.test(h) ? 'name'
        : /cedula|documento|\bcc\b|identificacion|\bdni\b/.test(h) ? 'cedula' : /usuario|user|login/.test(h) ? 'user'
        : /correo|email|mail/.test(h) ? 'email' : /celular|telefono|movil|phone/.test(h) ? 'phone' : /direccion|address/.test(h) ? 'address' : null);
      if (!kinds.some(Boolean)) continue;
      let pos = tb.index + tb[0].indexOf(tb[2]);
      for (const row of tb[2].split(/(?<=\n)/)) {
        const cells = row.replace(/\r?\n$/, '').split('|').slice(1, -1);
        let off = pos + 1;
        cells.forEach((c, i) => {
          const val = c.trim(), kind = kinds[i];
          const cs = off + c.indexOf(val);
          off += c.length + 1;
          if (!kind || !val || /^(?:CL|PG|TX|PQR|KP)-/.test(val) || /^[-–—]$|^n\/?a$/i.test(val)) return;
          if (kind === 'name' && !/^\p{L}+(?:[ '-]+\p{L}+\.?)*$/u.test(val)) return;
          if (kind === 'name' && (KEEP.some(k => norm(k) === norm(val)) || !val.split(/\s+/).some(w => this.knownFirst.has(norm(w)) || this.knownSur.has(norm(w))))) return;
          if ((kind === 'cedula' || kind === 'phone') && digits(val).length < 6) return;
          // un nombre de pila solo en la tabla ("| Gerardo |") lo resuelve el paso de colegas, no un tercero nuevo
          if (kind === 'name' && !/\s/.test(val)) return;
          this.fieldValue(push, ctx, recId, cs, val, kind);
        });
        pos += row.length;
      }
    }

    // 10-campos. registros pegados como texto: JSON ("nombre": "…"), XML (<email>…</email>), "clave: valor"
    // y líneas delimitadas (usuario;cédula;correo;celular). Cada campo personal se reemplaza entero.
    const FIELD = { nombre: 'name', name: 'name', nombre_completo: 'name', full_name: 'name', titular: 'name', cliente: 'name', apellidos: 'name', nombres: 'name',
      documento: 'cedula', cedula: 'cedula', doc: 'cedula', num_doc: 'cedula', dni: 'cedula', identificacion: 'cedula',
      email: 'email', correo: 'email', mail: 'email', telefono: 'phone', celular: 'phone', phone: 'phone', movil: 'phone', tel: 'phone',
      direccion: 'address', address: 'address', usuario: 'user', user: 'user', username: 'user', login: 'user' };
    const fieldRx = /(["']?)\b([A-Za-zÁÉÍÓÚáéíóúñ_]{3,16})\1\s*[:=]\s*"([^"\n]{2,80})"|<([A-Za-z_]{3,16})>([^<\n]{2,80})<\/\4>/g;
    for (const m of text.matchAll(fieldRx)) {
      const key = norm(m[2] || m[4]).replace(/\s/g, '_'), val = m[3] ?? m[5];
      const kind = FIELD[key];
      if (!kind || /^(?:CL|TX|PQR|KP)-/.test(val) || KEEP.some(k => norm(k) === norm(val))) continue;
      const start = m.index + m[0].lastIndexOf(val);
      // "Av. Boyacá #45-67, Bogotá": la ciudad se conserva, solo cambia la dirección
      const city = kind === 'address' ? (val.match(/,\s*[\p{L} .]+$/u) || [''])[0] : '';
      this.fieldValue(push, ctx, recId, start, val.slice(0, val.length - city.length), kind);
    }
    for (const line of text.matchAll(/[^\n]*[;|\t][^\n]*/g)) {
      const parts = line[0].split(/([;|\t])/);
      if (parts.filter((_, i) => i % 2 === 0).length < 3) continue;
      if (!parts.some(p => /@|(?<!\d)3\d{9}(?!\d)/.test(p))) continue;
      let off = line.index;
      for (let i = 0; i < parts.length; i++) {
        const raw = parts[i];
        if (i % 2 === 0) {
          // la primera y la última celda pueden traer texto alrededor: se toma la palabra pegada al separador
          const cell = i === 0 ? (raw.match(/[\p{L}\d._@+-]+(?:[ ][\p{Lu}][\p{L}]+){0,3}$/u) || [''])[0] : i === parts.length - 1 ? (raw.match(/^[\p{L}\d._@+-]+/u) || [''])[0] : raw.trim();
          const cs = off + (i === 0 ? raw.length - cell.length : raw.indexOf(cell));
          const d = digits(cell);
          if (/^\d[\d.\s-]{5,14}\d$/.test(cell) && d.length >= 6 && d.length <= 12 && !/^3\d{9}$/.test(d)) this.fieldValue(push, ctx, recId, cs, cell, 'cedula');
          else if (/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$|^[a-z]+\d+$/i.test(cell) && !cell.includes('@')) this.fieldValue(push, ctx, recId, cs, cell, 'user');
          else if (/^\p{Lu}\p{Ll}+(?: \p{Lu}\p{Ll}+){1,3}$/u.test(cell) && this.knownFirst.has(norm(cell.split(' ')[0]))) this.fieldValue(push, ctx, recId, cs, cell, 'name');
        }
        off += raw.length;
      }
    }

    // 10-pista. "soy / me llamo / mi nombre es / a nombre de / habla / Sr. / Sra." + 2 a 4 palabras con mayúscula:
    // es un nombre de persona aunque el nombre de pila no esté en ningún catálogo ("soy Rigoberta Quintanilla")
    // (sin bandera i: con ella \p{Lu} también aceptaría minúsculas; la pista se escribe en ambas formas).
    // Acepta MAYÚSCULAS, partículas (María del Pilar), pistas en inglés, firmas y tratamientos con un solo apellido.
    const W = '(?:\\p{Lu}\\p{Ll}+|\\p{Lu}{2,})';
    const P = '(?:de|del|de la|de los|y|DE|DEL)';
    // un nombre nunca cruza de línea: en una firma "Milton Rojas\nAnalista de Cobranza\nKipu Pay" el cargo no es nombre
    const NAME = `${W}(?:[ \\t]+(?:${P}[ \\t]+)?${W}){1,4}`;
    const cueRx = new RegExp(`(?<![\\p{L}])(?:[Ss]oy|[Mm]e llamo|[Mm]i nombre es|[Aa] nombre de|[Hh]abla|[Ll]e habla|[Tt]itular:?|[Mm]y name is|I'm|I’m|I am|[Tt]his is|[Ee]l nombre del? \\p{Ll}+ es|[Ee]stimad[oa]|[Qq]uerid[oa]|[Dd]ear|[Hh]ola,?|[Hh]i,?|[Hh]ello,?|[Bb]uen(?:os|as)? (?:d[ií]as?|tardes|noches),?|[Ss]aludos,?|[Aa]tentamente,?|[Gg]racias,?|[Aa]tte\\.?,?|[Cc]ordialmente,?)\\s+(${NAME})(?![\\p{L}])`, 'gu');
    const honorRx = new RegExp(`(?<![\\p{L}])(?:[Ss]eñor|[Ss]eñora|[Ss]r\\.|[Ss]ra\\.|[Dd]on|[Dd]oña|[Dd]r\\.|[Dd]ra\\.|[Dd]octor|[Dd]octora|Mr\\.|Mrs\\.|Ms\\.)\\s+(${W}(?:[ \\t]+(?:${P}[ \\t]+)?${W}){0,4})(?![\\p{L}])`, 'gu');
    const signRx = new RegExp(`(?:^|\\n|[.!]\\s+)(?:—|--|–|[Aa]tentamente,?|[Cc]ordialmente,?|[Ss]aludos,?|[Uu]n abrazo,?|[Bb]endiciones,?)\\s*(${W}(?:[ \\t]+${W}){0,3})\\s*$`, 'gu');
    const onName = (full, start, single) => {
      const toks = full.split(/\s+/).filter(t => !/^(de|del|la|los|y)$/i.test(t));
      if (!toks.length || norm(toks[0]) === 'kipi') return; // tras "soy/me llamo" siempre es persona (salvo el bot)
      if (KEEP.some(k => norm(k) === norm(full) || norm(full).startsWith(norm(k) + ' '))) return;
      if (toks.length === 1 && !single) return;
      if (this.forms.has(norm(full)) || this.forms.has(norm(toks.join(' ')))) return; // persona del registro: la cubre el paso 8
      // prioridad 5: gana a la detección genérica de terceros del mismo tramo y deja registrada a quien se presenta
      push(start, start + full.length, 5, () => {
        // las partículas no cuentan como nombres: "María del Pilar Gómez" → ficha "María Pilar Gómez"
        const clean = toks.map(t => (t === t.toUpperCase() ? t[0] + t.slice(1).toLowerCase() : t)).join(' ');
        const e = reg.newTercero(toks.length === 1 && single === 'surname' ? `X ${clean}` : clean);
        if (single !== 'surname') this.curIntro = e;
        const v = this.renderName(e, full);
        this.touch(e, recId, full, 'name', titleOf(v));
        return v;
      }, false);
    };
    for (const m of text.matchAll(cueRx)) onName(m[1], m.index + m[0].length - m[1].length, false);
    for (const m of text.matchAll(honorRx)) onName(m[1], m.index + m[0].length - m[1].length, 'surname');
    for (const m of text.matchAll(signRx)) onName(m[1], m.index + m[0].length - m[1].length - (m[0].length - m[0].trimEnd().length), true);
    // un solo nombre de pila (con o sin inicial) tras una pista: "soy Camila", "me llamo Andrés", "soy Mateo J."
    const singleRx = new RegExp(`(?<![\\p{L}])(?:[Ss]oy|[Mm]e llamo|[Mm]i nombre es|[Mm]y name is|I'm|I’m|I am|[Ee]scribo como|[Aa]quí|[Ee]n nombre de)\\s+(\\p{Lu}\\p{Ll}+(?:\\s+\\p{Lu}\\.)?)(?![\\p{L}])`, 'gu');
    for (const m of text.matchAll(singleRx)) {
      if (!this.knownFirst.has(norm(m[1].split(/\s+/)[0]))) continue;
      onName(m[1], m.index + m[0].length - m[1].length, true);
    }
    // más pistas con nombre completo: "escribo como Mariana de los Santos", "en nombre de María Torres"
    const moreRx = new RegExp(`(?<![\\p{L}])(?:[Ee]scribo como|[Ee]n nombre de|[Aa]quí)\\s+(${NAME})(?![\\p{L}])`, 'gu');
    for (const m of text.matchAll(moreRx)) onName(m[1], m.index + m[0].length - m[1].length, false);
    // nombre en minúsculas tras una pista fuerte: "hola me llamo pedro ramírez", "soy carlos m."
    for (const m of text.matchAll(/(?<![\p{L}])(?:me llamo|mi nombre es|soy|a nombre de)\s+([a-záéíóúñü]+(?:\s+[a-záéíóúñü]+\.?){1,3})/gu)) {
      const words = m[1].split(/\s+/).map(w => (/^[a-z]\.$/.test(w) ? w : w.replace(/[.,;:]+$/, '')));
      if (!this.knownFirst.has(norm(words[0]))) continue;
      let k = 1;
      while (k < words.length && (this.knownSur.has(norm(words[k])) || this.knownFirst.has(norm(words[k])) || /^[a-z]\.$/.test(words[k]))) k++;
      if (k < 2) continue;
      const full = words.slice(0, k).join(' ');
      const start = m.index + m[0].length - m[1].length;
      const cap = full.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
      if (this.forms.has(norm(full))) {
        const cands = this.forms.get(norm(full)).map(c => c.e);
        push(start, start + full.length, 6, () => { const e = this.pick(cands, ctx, start, text); const v = this.renderName(e, full); this.touch(e, recId, full, 'name', titleOf(v)); return v; }, false);
      } else {
        push(start, start + full.length, 4, () => { const e = reg.newTercero(cap); const v = this.renderName(e, full); this.touch(e, recId, full, 'name', titleOf(v)); return v; }, false);
      }
    }

    // 10a. terceros por parentesco con solo nombre de pila: "mi hermano Daniel", "mi socia Laura"
    for (const m of text.matchAll(/\b(?:[Mm]i|[Ss]u|[Tt]u|[Nn]uestro|[Nn]uestra)\s+(?:herman[oa]|espos[oa]|mam[áa]|pap[áa]|madre|padre|hij[oa]|prim[oa]|t[íi][oa]|amig[oa]|soci[oa]|novi[oa]|cuñad[oa]|suegr[oa]|compañer[oa]|jef[ea]|vecin[oa]|sobrin[oa]|abuel[oa]|pareja|marido|mujer|arrendador[a]?|empleador[a]?|cliente|codeudor[a]?|fiador[a]?|beneficiari[oa]|referencia|apoderad[oa]|representante)[,:]?\s+(?:(?:es|era|será|sería|se llama|is)\s+)?(\p{Lu}\p{Ll}{2,}(?:\s+\p{Lu}\p{Ll}{2,}){0,2})/gu)) {
      const name = m[1];
      // tras un parentesco cualquier palabra con mayúscula es un nombre, salvo marcas, lugares o el bot
      if (norm(name.split(/\s+/)[0]) === 'kipi' || KEEP.some(k => norm(name).startsWith(norm(k)))) continue;
      if (this.forms.has(norm(name))) continue; // persona del registro: la cubre el paso 8
      const start = m.index + m[0].length - name.length;
      push(start, start + name.length, 4, () => {
        // el mismo pariente de la misma persona es una sola ficha; el "Daniel" de otra persona es otra
        const e = reg.newTercero(name, ctx.author?.key || ctx.linked?.[0]?.key || recId || '');
        const v = this.renderName(e, name);
        this.touch(e, recId, name, 'name', titleOf(v));
        return v;
      }, false);
    }

    // 10b. terceros dentro de nombres de archivo: certificado_laboral_jorge_pinto.pdf, extracto-ana-ruiz.jpg
    for (const m of text.matchAll(/[\p{L}0-9_\-]+\.(?:pdf|jpe?g|png|docx?|xlsx?|csv|heic)\b/giu)) {
      const parts = [...m[0].replace(/\.[a-z]+$/i, '').matchAll(/[\p{L}0-9]+/gu)];
      for (let k = 0; k + 1 < parts.length; k++) {
        const a = parts[k], b = parts[k + 1];
        const f = norm(a[0]), s = norm(b[0]);
        if (!/^[a-z]{3,}$/.test(f) || !/^[a-z]{3,}$/.test(s)) continue;
        if (!this.knownFirst.has(f) || STAFF_WORDS.has(f) || (this.knownFirst.has(s) && !this.knownSur.has(s))) continue;
        if (this.forms.has(`${f} ${s}`)) continue; // ya es una persona del registro (lo cubre el paso 8)
        const start = m.index + a.index, stop = m.index + b.index + b[0].length;
        const orig = text.slice(start, stop);
        const cap = w => w[0].toUpperCase() + w.slice(1).toLowerCase();
        push(start, stop, 4, () => {
          const e = reg.newTercero(`${cap(a[0])} ${cap(b[0])}`);
          const v = this.renderName(e, orig);
          this.touch(e, recId, orig);
          return v;
        }, false);
        k++;
      }
    }

    // 11. cuasi-identificadores: ocupación → sector, barrio → ciudad, año de vinculación → "hace unos años"
    if (ctx.quasi !== false) {
      for (const m of text.matchAll(this.rxOcc)) {
        if (/^\p{Lu}/u.test(m[0])) continue; // cargos con mayúscula ("Contadora") se conservan
        const v = SECTOR[m[0].toLowerCase()];
        if (v) push(m.index, m.index + m[0].length, 3, () => v, false);
      }
      if (this.rxBarrio) for (const m of n.matchAll(this.rxBarrio)) {
        const cities = [...(this.barrioCity.get(m[0]) || [])];
        const ctxCity = this.ctxPerson(ctx)?.city;
        const city = cities.includes(ctxCity) ? ctxCity : cities[0];
        if (!city) continue;
        const orig = text.slice(map[m.index], map[m.index + m[0].length - 1] + 1);
        if (!/^\p{Lu}/u.test(orig)) continue;
        push(m.index, m.index + m[0].length, 3, () => city);
      }
      for (const m of text.matchAll(/\b(19[5-9]\d|20[0-2]\d)\b/g)) {
        const before = text.slice(Math.max(0, m.index - 45), m.index);
        if (!RX_YEAR_CUE.test(before)) continue;
        if (/(19|20)\d\d-\d/.test(text.slice(m.index, m.index + 6))) continue;
        if (/\d{1,2} de [a-záéíóú]+ de $/i.test(before)) continue; // fecha completa: "4 de abril de 2024"
        push(m.index, m.index + 4, 3, () => 'hace unos años', false);
      }
    }

    // resolver solapes: más largo primero, luego prioridad
    spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || b.prio - a.prio);
    const chosen = [];
    for (const sp of spans) {
      const last = chosen[chosen.length - 1];
      if (last && sp.start < last.end) {
        const lenA = last.end - last.start, lenB = sp.end - sp.start;
        if (lenB > lenA || (lenB === lenA && sp.prio > last.prio)) chosen[chosen.length - 1] = sp;
        continue;
      }
      chosen.push(sp);
    }
    let out = '', pos = 0;
    for (const sp of chosen) {
      out += text.slice(pos, sp.start);
      out += sp.fn ? sp.fn() : text.slice(sp.start, sp.end);
      pos = sp.end;
    }
    return out + text.slice(pos);
  }

  /** Dueño de un dato que no está en ningún maestro: la persona del contexto, o una entidad propia. */
  /** Campo personal de un registro pegado como texto (JSON, XML, CSV): se reemplaza el valor completo. */
  fieldValue(push, ctx, recId, start, val, kind) {
    const reg = this.reg;
    push(start, start + val.length, 9, () => {
      if (kind === 'name') {
        const cands = this.forms.get(norm(val));
        const e = cands?.length ? this.pick(cands.map(c => c.e), ctx, start, this.curText) : reg.newTercero(val);
        const v = this.renderName(e, val);
        this.touch(e, recId, val, 'name', titleOf(v));
        return v;
      }
      const d = digits(val);
      const e = kind === 'email' ? (reg.byEmail.get(val.toLowerCase()) || this.ownerForUnknown(ctx, 'email', val))
        : kind === 'cedula' ? (reg.byCedula.get(d) || this.ownerForUnknown(ctx, 'cedula', d))
        : kind === 'phone' ? (reg.byPhone.get(d.slice(-10)) || this.ownerForUnknown(ctx, 'phone', d.slice(-10)))
        : this.localIndex.get(val.toLowerCase())?.e || this.ctxPerson(ctx) || reg.newValueEntity(kind, val);
      const p = reg.pseudo(e);
      let v;
      if (kind === 'email') v = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(val) ? reg.pseudoEmail(e, val) : reg.pseudoEmail(e, val.replace(/[@#]+/g, '@').replace(/^([^@]*)$/, '$1@mail.com'));
      else if (kind === 'cedula') v = formatLike(e.cedulas.has(d) && [...e.cedulas][0] === d ? p.cedula : fakeFrom(e.key + d, d), val);
      else if (kind === 'phone') v = formatLike(e.phones.has(d.slice(-10)) ? p.phone : '3' + fakeFrom(e.key + d, d.slice(-10)).slice(1), val);
      else if (kind === 'address') v = p.address;
      else {
        const base = reg.pseudoHandle(e, val.includes('.') ? 'a.b' : val.includes('_') ? 'a_b' : 'ab');
        const tail = (val.match(/\d+$/) || [''])[0];
        v = base + (tail ? fakeFrom(e.key + val, tail.padStart(2, '1')).slice(0, tail.length) : '');
      }
      this.touch(e, recId, val, kind === 'user' ? null : kind, v);
      return v;
    }, false);
  }

  ownerForUnknown(ctx, type, value) {
    const known = { email: this.reg.byEmail, phone: this.reg.byPhone, cedula: this.reg.byCedula }[type]?.get(type === 'email' ? value.toLowerCase() : digits(value));
    if (known) return known;
    // un correo nuevo cuyo usuario es "inicial+apellido" o "nombre.apellido" de un nombre del mismo texto es esa persona
    if (type === 'email' && (this.curText || ctx.blob)) {
      const local = norm(value.split('@')[0]).replace(/[^a-z._]/g, '');
      for (const m of `${this.curText || ''}\n${ctx.blob || ''}`.matchAll(/\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+){1,3}/gu)) {
        const t = norm(m[0]).split(' ');
        for (let k = 1; k < t.length; k++) {
          const f = t[0], s = t[k];
          // inicial+apellido, nombre.apellido, y apodo (prefijo de 4+ letras del nombre) + apellido: valen.ospitia
          const pre = local.split(/[._]/)[0];
          const nick = pre.length >= 4 && f.startsWith(pre) && local.slice(pre.length).replace(/^[._]/, '') === s;
          if (!nick && ![f[0] + s, `${f}.${s}`, f + s, `${f}_${s}`, `${f[0]}.${s}`].includes(local)) continue;
          const name = m[0].split(/\s+/).slice(0, k + 1).join(' ');
          // si quien se presentó en el texto tiene ese nombre y apellido, el correo es suyo
          const intro = this.curIntro;
          if (intro && intro.tokens.map(norm).includes(f) && intro.tokens.map(norm).includes(s)) {
            intro.emails.add(value.toLowerCase()); this.reg.byEmail.set(value.toLowerCase(), intro); return intro;
          }
          const cands = this.forms.get(norm(name));
          const e = cands?.length ? this.pick(cands.map(c => c.e), ctx, 0, this.curText) : (this.knownFirst.has(f) ? this.reg.newTercero(name) : null);
          if (e) { e.emails.add(value.toLowerCase()); this.reg.byEmail.set(value.toLowerCase(), e); return e; }
        }
      }
    }
    const e = this.ctxPerson(ctx) || this.curIntro;
    if (e) {
      if (type === 'email') { e.emails.add(value.toLowerCase()); this.reg.byEmail.set(value.toLowerCase(), e); }
      if (type === 'phone') { e.phones.add(digits(value)); this.reg.byPhone.set(digits(value), e); }
      if (type === 'cedula') { e.cedulas.add(digits(value)); this.reg.byCedula.set(digits(value), e); }
      return e;
    }
    const v = this.reg.newValueEntity(type, value);
    if (type === 'email') this.reg.byEmail.set(value.toLowerCase(), v);
    if (type === 'phone') this.reg.byPhone.set(digits(value), v);
    if (type === 'cedula') this.reg.byCedula.set(digits(value), v);
    return v;
  }
}

function titleOf(v) {
  return v.split(/[\s_.\-]+/).map(w => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ');
}

import crypto from 'node:crypto';
function fakeFrom(seed, like) {
  const hh = crypto.createHash('sha256').update('kipu|' + seed).digest('hex').replace(/\D/g, '') + '0123456789';
  let out = like[0] + hh.slice(0, like.length - 1);
  if (out.slice(0, 4) === like.slice(0, 4)) out = out[0] + String((+out[1] + 3) % 10) + out.slice(2);
  return out;
}
function fakeBirthFrom(seed) {
  const hh = crypto.createHash('sha256').update('birth|' + seed).digest();
  return `${1960 + (hh[0] % 45)}-${String(1 + (hh[1] % 12)).padStart(2, '0')}-${String(1 + (hh[2] % 28)).padStart(2, '0')}`;
}
function fakePassportFrom(seed) {
  const hh = crypto.createHash('sha256').update('passport|' + seed).digest();
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  return L[hh[0] % L.length] + L[hh[1] % L.length] + String(hh.readUInt32BE(2) % 1e6).padStart(6, '0');
}
function fakePlateFrom(seed) {
  const hh = crypto.createHash('sha256').update('plate|' + seed).digest();
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  return L[hh[0] % L.length] + L[hh[1] % L.length] + L[hh[2] % L.length] + String(hh.readUInt16BE(3) % 1000).padStart(3, '0');
}

// palabras que también son nombres de pila pero en texto interno suelen ser otra cosa
// palabras con mayúscula que siguen a un nombre de pila sin ser apellido
const NOT_SURNAME = new Set(['kipu', 'pay', 'kipi', 'pagalo', 'cliente', 'clienta', 'agente', 'soporte', 'equipo', 'gerente', 'analista', 'coordinador', 'coordinadora', 'director', 'directora',
  'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  'hola', 'gracias', 'buenas', 'buenos', 'saludos', 'atentamente', 'cordialmente', 'por', 'para', 'con', 'que', 'pero', 'como', 'cuando', 'donde', 'este', 'esta', 'the', 'and', 'from', 'team',
  'cedula', 'correo', 'celular', 'usuario', 'cuenta', 'tarjeta', 'credito', 'pse', 'nequi', 'daviplata', 'colombia', 'sur', 'norte', 'centro', 'oriente', 'occidente', 'ok', 'si', 'no', 'ya']);
const CITY_N = new Set(CITIES.flatMap(c => norm(c).split(' ')));

const STAFF_WORDS = new Set(['maria', 'rosa', 'luz', 'flor', 'pilar', 'mercedes', 'victoria', 'angel', 'cruz', 'paz', 'reyes', 'santos', 'socorro', 'esperanza', 'amparo', 'consuelo', 'dolores', 'milagros', 'gracia', 'nieves', 'rocio', 'soledad', 'blanca', 'aurora', 'kipi']);

const EXTRA_FIRST = ['paulina', 'erik', 'william', 'jhonatan', 'jonathan', 'john', 'brian', 'maicol', 'michael', 'yeison', 'jeison', 'stiven', 'steven', 'edison', 'fredy', 'freddy', 'harold', 'yesid', 'yurany', 'leidy', 'jessica', 'yesica', 'jenny', 'yohana', 'luisa', 'erika', 'erica', 'karen', 'katherine', 'estefania', 'stephanie', 'yenny', 'dayana', 'luz', 'nancy', 'daniel', 'hernando', 'ramiro', 'ernesto', 'francisco', 'roberto', 'maria', 'jose', 'juan', 'luis', 'carlos', 'jorge', 'andres', 'camila', 'laura', 'ana', 'sebastian', 'santiago', 'valentina', 'daniela', 'alejandro', 'felipe', 'pedro', 'pablo', 'diana', 'paola', 'natalia', 'carolina', 'juliana', 'esteban', 'mateo', 'samuel', 'nicolas', 'david', 'miguel', 'angela', 'monica', 'sandra', 'claudia', 'martha', 'gloria', 'lucia', 'isabel', 'ines', 'manuela', 'mariana', 'sara', 'sofia', 'lina', 'catalina', 'andrea', 'adriana', 'liliana', 'patricia', 'carmen', 'rosa', 'beatriz', 'teresa', 'margarita', 'julian', 'cristian', 'oscar', 'ricardo', 'fernando', 'hernan', 'jaime', 'mauricio', 'diego', 'javier', 'victor', 'raul', 'ruben', 'hector', 'eduardo', 'gabriel', 'ivan', 'brayan', 'kevin', 'yesenia', 'yuliana', 'yamid', 'nohora', 'kelly', 'jhon', 'wilson', 'edwin', 'fabian', 'milton', 'farid', 'norberto', 'emilia', 'emilio', 'jeronimo', 'bibiana', 'ivonne', 'adela', 'lizeth', 'amalia', 'juana', 'clara', 'celeste', 'fernanda', 'pamela', 'adrian', 'dora', 'benjamin', 'mario', 'martin', 'tomas', 'mercedes'];
const EXTRA_SUR = ['gomez', 'rodriguez', 'martinez', 'garcia', 'lopez', 'gonzalez', 'hernandez', 'perez', 'sanchez', 'ramirez', 'torres', 'diaz', 'moreno', 'munoz', 'rojas', 'alvarez', 'romero', 'ruiz', 'castro', 'ortiz', 'gutierrez', 'restrepo', 'mejia', 'castano', 'ospina', 'henao', 'giraldo', 'zapata', 'arango', 'velasquez', 'hoyos', 'montoya', 'cardona', 'osorio', 'betancur', 'correa', 'quintero', 'posada', 'salazar', 'vargas', 'jimenez', 'londono', 'aristizabal', 'marulanda', 'ordonez', 'santander', 'bolivar', 'castilla', 'robledo', 'galan', 'carulla', 'jaramillo', 'botero', 'calle', 'duque', 'echeverri', 'uribe', 'velez', 'serna', 'arias', 'agudelo'];
