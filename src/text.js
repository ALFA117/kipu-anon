// Normalización de texto. Sigue la misma idea que el juez (validar.mjs): NFKC, confusables,
// sin tildes, minúsculas. Además guarda el índice original de cada carácter normalizado
// para poder reemplazar el span real en el texto de entrada.

const CONFUSABLES = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'ј': 'j', 'ѕ': 's',
  'А': 'A', 'Е': 'E', 'О': 'O', 'Р': 'P', 'С': 'C', 'Х': 'X', 'У': 'Y', 'І': 'I', 'Ј': 'J', 'Ѕ': 'S',
  'В': 'B', 'Н': 'H', 'К': 'K', 'М': 'M', 'Т': 'T', 'ο': 'o', 'α': 'a', 'ρ': 'p', 'ν': 'v', 'ι': 'i',
  'ℓ': 'l', 'ı': 'i', 'ɑ': 'a',
};
const RX_MARK = /\p{Mn}/gu;
const RX_FORMAT = /\p{Cf}/u;
const RX_SPACE = /[\p{Zs}\t\r\n\v\f]/u;

function normChar(c) {
  if (RX_FORMAT.test(c)) return '';
  if (RX_SPACE.test(c)) return ' ';
  let s = c.normalize('NFKC');
  s = CONFUSABLES[s] ?? s;
  return s.normalize('NFD').replace(RX_MARK, '').toLowerCase();
}

/** Normaliza y devuelve { s, map } donde map[i] es el índice original del carácter i de s. */
export function normMap(text) {
  let s = '';
  const map = [];
  let i = 0;
  for (const ch of text) {
    const n = normChar(ch);
    // una entrada del mapa por unidad UTF-16: los emojis (👍) ocupan dos y si no se corre todo lo que sigue
    for (const x of n) { s += x; for (let u = 0; u < x.length; u++) map.push(i); }
    i += ch.length;
  }
  map.push(text.length);
  return { s, map };
}

export function norm(text) {
  return normMap(text).s.replace(/ {2,}/g, ' ');
}

export function stripAccents(s) {
  return s.normalize('NFD').replace(RX_MARK, '');
}

export function digits(s) {
  return s.replace(/\D/g, '');
}

export function escapeRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

export function titleCase(s) {
  return s.split(' ').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

/** Detecta el estilo de una mención para renderizar el seudónimo igual. */
export function styleOf(mention) {
  const letters = mention.replace(/[^\p{L}]/gu, '');
  const sep = (mention.match(/[_.\-]/) || [' '])[0];
  if (letters && letters === letters.toUpperCase()) {
    return { upper: true, accents: /[ÁÉÍÓÚÑÜ]/.test(mention), sep };
  }
  if (letters && letters === letters.toLowerCase()) {
    return { lower: true, accents: /[áéíóúñü]/.test(mention), sep };
  }
  return { sep: ' ' };
}

export function render(name, style) {
  let out = name;
  if (style.upper) out = (style.accents ? out : stripAccents(out)).toUpperCase();
  else if (style.lower) out = (style.accents ? out : stripAccents(out)).toLowerCase();
  if (style.sep && style.sep !== ' ') out = out.split(' ').join(style.sep);
  return out;
}
