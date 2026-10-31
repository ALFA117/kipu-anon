// Copia literal de las funciones de texto del juez (material/validar.mjs) para medir igual que él.
// juez/texto.ts
var ESPACIO = "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
var PALABRA = "\\p{L}\\p{N}_";
var CONFUSABLES = {
  \u0430: "a",
  \u0435: "e",
  \u043E: "o",
  \u0440: "p",
  \u0441: "c",
  \u0445: "x",
  \u0443: "y",
  \u0456: "i",
  \u0458: "j",
  \u0455: "s",
  \u0410: "A",
  \u0415: "E",
  \u041E: "O",
  \u0420: "P",
  \u0421: "C",
  \u0425: "X",
  \u0423: "Y",
  \u0406: "I",
  \u0408: "J",
  \u0405: "S",
  \u0412: "B",
  \u041D: "H",
  \u041A: "K",
  \u041C: "M",
  \u0422: "T",
  \u03BF: "o",
  \u03B1: "a",
  \u03C1: "p",
  \u03BD: "v",
  \u03B9: "i",
  \u2113: "l",
  \u0131: "i",
  \u0251: "a"
};
var RX_CONFUSABLE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "gu");
var RX_FORMATO = new RegExp("\\p{Cf}", "u");
var RX_ESPACIO_RARO = /[\p{Zs}\t\r\n\v\f]/u;
var RX_ESPACIOS = / {2,}/g;
var RX_MARCA = new RegExp("\\p{Mn}", "gu");
var RX_SEPARADOR_DIGITOS = new RegExp(`(?<=\\p{Nd})[${ESPACIO}.,'\u2019\`\xB4\xB7/\\-\u2013\u2014_](?=\\p{Nd})`, "gu");
var RX_NO_DIGITO = new RegExp("\\P{Nd}", "gu");
var RX_TEXTO = new RegExp(`^[${PALABRA} .'_-]+$`, "u");
var RX_TOKENS = new RegExp(`[${PALABRA}]+|[^${PALABRA}${ESPACIO}]`, "gu");
var RX_BLANCOS = new RegExp(`[${ESPACIO}]+`, "u");
function escaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
function partir(s) {
  return s.split(RX_BLANCOS).filter((x) => x !== "");
}
function largo(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}
function plegar(s) {
  return s.toLowerCase().replace(/ß/g, "ss").replace(/ς/g, "\u03C3").replace(/ſ/g, "s");
}
function quitarTildes(s) {
  return s.normalize("NFD").replace(RX_MARCA, "");
}
function clean(s) {
  const base = s.normalize("NFKC").replace(RX_CONFUSABLE, (c) => CONFUSABLES[c] ?? c);
  let out = "";
  for (const c of base) {
    if (RX_FORMATO.test(c)) continue;
    out += RX_ESPACIO_RARO.test(c) ? " " : c;
  }
  return out.replace(RX_ESPACIOS, " ");
}
var cacheNorm = /* @__PURE__ */ new Map();
function norm(s) {
  let r = cacheNorm.get(s);
  if (r === void 0) {
    r = plegar(quitarTildes(clean(s)));
    if (cacheNorm.size > 2e5) cacheNorm.clear();
    cacheNorm.set(s, r);
  }
  return r;
}
var cacheCompacto = /* @__PURE__ */ new Map();
function digitosCompactos(s) {
  let r = cacheCompacto.get(s);
  if (r === void 0) {
    r = clean(s).replace(RX_SEPARADOR_DIGITOS, "");
    if (cacheCompacto.size > 2e5) cacheCompacto.clear();
    cacheCompacto.set(s, r);
  }
  return r;
}
function soloDigitos(s) {
  return s.replace(RX_NO_DIGITO, "");
}
var cacheRx = /* @__PURE__ */ new Map();
function rx(fuente, flags = "u") {
  const clave = `${flags}/${fuente}`;
  let r = cacheRx.get(clave);
  if (!r) {
    r = new RegExp(fuente, flags);
    if (cacheRx.size > 5e4) cacheRx.clear();
    cacheRx.set(clave, r);
  }
  return r;
}
function digitosEn(haystack, digitos) {
  const compacto = digitosCompactos(haystack);
  const candidatos = /* @__PURE__ */ new Set([digitos]);
  if (digitos.length === 12 && digitos.startsWith("57")) candidatos.add(digitos.slice(2));
  for (const d of candidatos)
    if (rx(`(?<!\\p{Nd})(?:57)?${escaparRegex(d)}(?!\\p{Nd})`).test(compacto)) return true;
  return false;
}
function contiene(haystack, needle, opciones = {}) {
  if (!needle) return false;
  if (opciones.exacto) return haystack.includes(needle);
  const digitos = soloDigitos(needle);
  if (digitos && largo(digitos) >= 6 && largo(digitos) >= 0.6 * largo(needle) && !/[a-zA-Z]/.test(needle))
    return digitosEn(haystack, digitos);
  const h = norm(haystack);
  const n = norm(needle);
  if (RX_TEXTO.test(n) && /[a-z]/.test(n)) {
    if (rx(`(?<![a-z0-9])${escaparRegex(n)}(?![a-z0-9])`).test(h)) return true;
    const palabras = partir(n);
    if (palabras.length >= 2 && palabras.every((w) => largo(w) >= 3))
      return rx(
        `(?<![a-z0-9])${palabras.map(escaparRegex).join(`[${ESPACIO}]*`)}(?![a-z0-9])`
      ).test(h);
    return false;
  }
  return h.includes(n);
}
export { norm, contiene, digitosCompactos, soloDigitos };
