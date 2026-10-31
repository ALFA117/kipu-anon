// Registro de identidades: cada persona real con todas sus formas y llaves fuertes,
// y su seudónimo determinista ψ(e) = catálogo[HMAC(sal, llave estable)].
import crypto from 'node:crypto';
import { norm, digits, stripAccents } from './text.js';
import { FEMALE, MALE, SURNAMES, FEMALE_EXTRA, MALE_A } from './catalog.js';

const SALT = process.env.PSEUDONYM_SALT || 'kipu-anon/frontier-cdmx-26';

/** Llave de persistencia: hash de la llave estable, para no guardar nombres reales en disco. */
export function hk(key) {
  return crypto.createHmac('sha256', SALT).update(`store|${key}`).digest('hex').slice(0, 24);
}

export function h(key, field, i = 0) {
  return crypto.createHmac('sha256', SALT).update(`${key}|${field}|${i}`).digest().readUInt32BE(0);
}

export class Entity {
  constructor(key, role) {
    this.key = key;
    this.role = role; // cliente | empleado | tercero | valor
    this.tokens = []; // nombre real en tokens (con tildes)
    this.firstCount = 1;
    this.gender = 'F';
    this.clientId = null;
    this.empId = null;
    this.uids = new Set();
    this.handles = new Set();
    this.cedulas = new Set();
    this.emails = new Set();
    this.phones = new Set();
    this.addresses = new Set();
    this.births = new Set();
    this.plates = new Set();
    this.passports = new Set();
    this.extraNames = new Set(); // otras formas de nombre (real_name corto, display_name)
    this.city = null;
    this.barrio = null;
    this.occupation = null;
    this.records = new Set();
    this.originals = new Set();
    this.used = {}; // tipo -> valor seudónimo realmente escrito
    this.usedNames = new Set();
    this.p = null; // seudónimo
  }
  get first() { return this.tokens.slice(0, this.firstCount); }
  get surnames() { return this.tokens.slice(this.firstCount); }
  get fullName() { return this.tokens.join(' '); }
}

function inferGender(firstName, hint) {
  if (hint === 'F' || hint === 'M') return hint;
  const n = norm(firstName);
  if (FEMALE_EXTRA.has(n)) return 'F';
  if (MALE_A.has(n)) return 'M';
  return n.endsWith('a') ? 'F' : 'M';
}

export class Registry {
  constructor() {
    this.entities = new Map();
    this.byClient = new Map();
    this.byEmp = new Map();
    this.byUid = new Map();
    this.byCedula = new Map();
    this.byEmail = new Map();
    this.byPhone = new Map();
    this.byHandle = new Map();
    this.byAddress = new Map();
    this.byBirth = new Map();
    this.byPlate = new Map();
    this.byPassport = new Map();
    this.firstNames = new Set(); // normalizados, reales
    this.surnameSet = new Set();
    this.taken = new Set(); // seudónimos (normalizados) ya asignados
    this.takenEmails = new Set();
    this.stored = {}; // seudónimos persistidos de corridas anteriores
  }

  get(key) { return this.entities.get(key); }

  add(e) { this.entities.set(e.key, e); return e; }

  setName(e, fullName, firstCountHint) {
    const toks = fullName.trim().split(/\s+/).filter(Boolean);
    e.tokens = toks;
    let fc = 1;
    if (firstCountHint) fc = firstCountHint;
    else if (toks.length >= 4) fc = toks.length - 2;
    else if (toks.length === 3) fc = this.firstNames.has(norm(toks[1])) && !this.surnameSet.has(norm(toks[1])) ? 2 : 1;
    e.firstCount = Math.max(1, Math.min(fc, toks.length - 1 || 1));
    if (toks.length === 1) e.firstCount = 1;
  }

  index(e) {
    if (e.clientId) this.byClient.set(e.clientId, e);
    for (const id of e.altClientIds || []) this.byClient.set(id, e);
    if (e.empId) this.byEmp.set(e.empId, e);
    for (const u of e.uids) this.byUid.set(u, e);
    for (const c of e.cedulas) this.byCedula.set(c, e);
    for (const m of e.emails) this.byEmail.set(m.toLowerCase(), e);
    for (const p of e.phones) this.byPhone.set(p, e);
    for (const hd of e.handles) this.byHandle.set(hd.toLowerCase(), e);
    for (const a of e.addresses) this.byAddress.set(norm(a), e);
    for (const b of e.births) this.byBirth.set(b, e);
  }

  /** Genera el seudónimo de forma determinista; reusa el persistido si existe. */
  pseudo(e) {
    if (e.p) return e.p;
    const st = this.stored[hk(e.key)];
    if (st) { e.p = JSON.parse(JSON.stringify(st)); return e.p; }
    const pool = e.gender === 'F' ? this.femalePool : this.malePool;
    const nFirst = Math.min(2, Math.max(1, e.firstCount));
    for (let i = 0; i < 500; i++) {
      const first = [];
      for (let k = 0; k < nFirst; k++) {
        let idx = h(e.key, `first${k}`, i) % pool.length;
        while (first.includes(pool[idx])) idx = (idx + 1) % pool.length;
        first.push(pool[idx]);
      }
      const s1 = this.surnamePool[h(e.key, 's1', i) % this.surnamePool.length];
      let s2 = this.surnamePool[h(e.key, 's2', i) % this.surnamePool.length];
      if (s2 === s1) s2 = this.surnamePool[(h(e.key, 's2', i) + 1) % this.surnamePool.length];
      const keyName = norm(first.join(' ') + ' ' + s1);
      const keyName1 = norm(first[0] + ' ' + s1);
      if (this.taken.has(keyName) || this.taken.has(keyName1)) continue;
      // el disfraz nunca repite un nombre o apellido de la persona real (terceros nuevos: "Jorge" → "Jorge")
      const real = new Set(e.tokens.map(norm));
      if ([...first, s1, s2].some(x => real.has(norm(x)))) continue;
      this.taken.add(keyName); this.taken.add(keyName1);
      e.p = { first, surnames: [s1, s2] };
      break;
    }
    const p = e.p;
    // ningún valor falso puede coincidir con un valor real de otra persona
    const real = this.realValues || new Set();
    for (let i = 0; i < 50; i++) {
      p.cedula = fakeDigits(e.key + (i ? `#${i}` : ''), 'cedula', [...e.cedulas][0] || '1000000000');
      if (!real.has(p.cedula)) break;
    }
    for (let i = 0; i < 50; i++) {
      p.phone = '3' + String(h(e.key, 'phone', i) % 1e9).padStart(9, '0').replace(/^(\d)/, d => '0125'[+d % 4]);
      if (!real.has(p.phone)) break;
    }
    for (let i = 0; i < 50; i++) {
      p.birth = fakeBirth(e.key + (i ? `#${i}` : ''), [...e.births][0]);
      if (!real.has(p.birth)) break;
    }
    p.address = fakeAddress(e.key);
    p.plate = fakePlate(e.key);
    p.passport = fakePassport(e.key);
    return p;
  }

  build() {
    this.realValues = new Set();
    for (const e of this.entities.values()) for (const s of [e.cedulas, e.phones, e.births]) for (const v of s) this.realValues.add(v);
    const realFirst = this.firstNames;
    const realSur = this.surnameSet;
    this.femalePool = FEMALE.filter(n => !realFirst.has(norm(n)) && !realSur.has(norm(n)));
    this.malePool = MALE.filter(n => !realFirst.has(norm(n)) && !realSur.has(norm(n)));
    this.surnamePool = SURNAMES.filter(n => !realSur.has(norm(n)) && !realFirst.has(norm(n)));
    // los seudónimos persistidos de corridas anteriores se reservan antes de generar los nuevos
    for (const st of Object.values(this.stored)) {
      this.taken.add(norm(st.first.join(' ') + ' ' + st.surnames[0]));
      this.taken.add(norm(st.first[0] + ' ' + st.surnames[0]));
      for (const v of Object.values(st.emails || {})) this.takenEmails.add(v);
    }
    for (const e of [...this.entities.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) {
      if (e.tokens.length) e.gender = inferGender(e.tokens[0], e.genderHint);
      this.pseudo(e);
    }
  }

  newTercero(fullName, hint = '') {
    const key = `ter:${norm(fullName)}${hint ? `|${hint}` : ''}`;
    let e = this.entities.get(key);
    if (e) return e;
    e = this.add(new Entity(key, 'tercero'));
    this.setName(e, fullName);
    e.gender = inferGender(e.tokens[0]);
    this.pseudo(e);
    return e;
  }

  newValueEntity(type, value) {
    const key = `val:${type}:${norm(value)}`;
    let e = this.entities.get(key);
    if (e) return e;
    e = this.add(new Entity(key, 'valor'));
    this.pseudo(e);
    return e;
  }

  // ---------- renderizado de seudónimos ----------
  pseudoEmail(e, realEmail) {
    const p = this.pseudo(e);
    p.emails = p.emails || {};
    const lower = realEmail.toLowerCase();
    if (p.emails[hk(lower)]) return p.emails[hk(lower)];
    const [local, domain = 'gmail.com'] = lower.split('@');
    const fn = stripAccents(p.first[0]).toLowerCase().replace(/[^a-z]/g, '');
    const sn = stripAccents(p.surnames[0]).toLowerCase().replace(/[^a-z]/g, '');
    const rf = e.tokens.length ? stripAccents(e.tokens[0]).toLowerCase() : '';
    let base;
    if (local.includes('.') || local.includes('_')) base = `${fn}${local.includes('_') ? '_' : '.'}${sn}`;
    else if (rf && local.startsWith(rf) && local.length > rf.length + 1) base = `${fn}${sn}`;
    else base = `${fn[0] || 'x'}${sn}`;
    let cand = `${base}@${domain}`;
    for (let i = 2; this.takenEmails.has(cand) || this.byEmail.has(cand); i++) cand = `${base}${i}@${domain}`;
    this.takenEmails.add(cand);
    p.emails[hk(lower)] = cand;
    return cand;
  }

  pseudoHandle(e, realHandle) {
    const p = this.pseudo(e);
    const fn = stripAccents(p.first[0]).toLowerCase();
    const sn = stripAccents(p.surnames[0]).toLowerCase();
    if (realHandle.includes('.')) return `${fn}.${sn}`;
    if (realHandle.includes('_')) return `${fn}_${sn}`;
    return `${fn[0]}${sn}`;
  }
}

// ---------- generadores de valores con formato válido ----------
export function fakeDigits(key, field, like) {
  const d = digits(like) || '1000000000';
  let out = '';
  for (let i = 0; i < d.length; i++) out += String(h(key, field, i) % 10);
  // conserva el primer dígito (prefijos de cédula plausibles) y evita quedar cerca del original
  out = d[0] + out.slice(1);
  if (out.slice(0, 4) === d.slice(0, 4)) out = out[0] + String((+out[1] + 3) % 10) + out.slice(2);
  return out;
}

export function formatLike(newDigits, original) {
  // reproduce separadores del original: 1.107.360.039 / 317 426 8173 / +57 ...
  const od = digits(original);
  let nd = newDigits;
  if (od.length === nd.length + 2 && od.startsWith('57')) nd = '57' + nd;
  let i = 0, out = '';
  for (const ch of original) {
    if (/\d/.test(ch)) out += nd[i++] ?? '';
    else out += ch;
  }
  return out + nd.slice(i);
}

function fakeBirth(key, real) {
  let y = 1960 + (h(key, 'by') % 45);
  if (real && /^\d{4}/.test(real)) y = +real.slice(0, 4) + ((h(key, 'by') % 7) - 3) || y;
  const m = 1 + (h(key, 'bm') % 12);
  const d = 1 + (h(key, 'bd') % 28);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function fakeAddress(key) {
  const types = ['Calle', 'Carrera', 'Cra', 'Cl', 'Diagonal', 'Transversal', 'Av'];
  const t = types[h(key, 'at') % types.length];
  const a = 1 + (h(key, 'a1') % 180);
  const suf = ['', 'A', 'B', ' Bis', ''][h(key, 'as') % 5];
  const b = 1 + (h(key, 'a2') % 120);
  const c = 1 + (h(key, 'a3') % 99);
  const extra = ['', ' apto ' + (101 + (h(key, 'ax') % 1500)), ' casa ' + (1 + (h(key, 'ax') % 80)), ''][h(key, 'ae') % 4];
  return `${t} ${a}${suf} # ${b}-${c}${extra}`;
}

function fakePlate(key) {
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  return L[h(key, 'p1') % L.length] + L[h(key, 'p2') % L.length] + L[h(key, 'p3') % L.length] + String(h(key, 'pn') % 1000).padStart(3, '0');
}

function fakePassport(key) {
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  return L[h(key, 'q1') % L.length] + L[h(key, 'q2') % L.length] + String(h(key, 'qn') % 1e6).padStart(6, '0');
}
