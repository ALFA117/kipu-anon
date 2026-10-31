"""Auditor independiente con IA (Python, solo librería estándar).

Lee la salida YA anonimizada y le pide a un modelo que marque cualquier dato que parezca de una
persona real (nombre, cédula, correo, celular, placa, dirección...). El modelo no ve los datos
originales ni sabe cómo trabaja el motor: solo ve lo que el comprador recibiría.

Después cruza cada hallazgo contra las fuentes originales: si el texto marcado también estaba en la
entrada, es una fuga confirmada; si no, era un seudónimo bien hecho (falso positivo del auditor).

uso:
  python -I auditor/auditor.py <output/> <fuentes/> [--limit N] [--model openai/gpt-4o-mini]
Necesita OPENROUTER_API_KEY en el entorno.
"""
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

PROMPT = """Eres auditor de privacidad. Recibes registros de un corpus de soporte de una fintech colombiana que YA fue anonimizado: las personas reales se reemplazaron por personas inventadas.

Tu trabajo: encontrar lo que se haya escapado. Marca SOLO datos que identifiquen a una persona natural:
nombres y apellidos de personas, cédulas, correos personales, celulares, placas, pasaportes, direcciones de vivienda, fechas de nacimiento, usuarios tipo nombre.apellido.

NO marques: bancos, empresas, marcas, comercios, lugares, ciudades, barrios, entidades públicas, figuras públicas (Shakira, presidentes), montos, fechas de transacción, ids internos (CL-, TX-, PQR-, KP-, INC-), ni a "Kipi" (el bot).

Estos nombres YA son seudónimos inventados y NO debes marcarlos: {pseudos}

Devuelve SOLO JSON: {{"hallazgos": [{{"id": "<id del registro>", "texto": "<fragmento exacto>", "tipo": "nombre|cedula|correo|celular|placa|pasaporte|direccion|nacimiento|usuario|otro", "por_que": "<breve>"}}]}}
Si no hay nada, devuelve {{"hallazgos": []}}.

Registros:
{records}"""


def norm(s):
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def read_jsonl(p):
    return [json.loads(l) for l in Path(p).read_text(encoding="utf-8").splitlines() if l.strip()]


def text_of(rec):
    if "text" in rec:
        files = " ".join(a.get("filename", "") for a in rec.get("attachments", []))
        return f"[autor: {rec.get('author', '')}] {rec['text']} {files}".strip()
    if "body" in rec:
        meta = " ".join(f"{k}={v}" for k, v in rec.get("metadata", {}).items())
        return f"[archivo: {rec.get('filename', '')}] [{meta}] {rec['body']}"
    cols = rec.get("columns", {})
    return " | ".join(f"{k}={v}" for k, v in cols.items())


def call(model, key, prompt, tries=3):
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }).encode()
    for i in range(tries):
        try:
            req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=body, headers={
                "Authorization": f"Bearer {key}", "Content-Type": "application/json",
                "X-Title": "kipu-anon auditor",
            })
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.loads(r.read())
            content = data["choices"][0]["message"]["content"]
            m = re.search(r"\{.*\}", content, re.S)
            return json.loads(m.group(0) if m else content), data.get("usage", {})
        except Exception as e:  # reintenta errores de red o JSON mal formado
            if i == tries - 1:
                return {"hallazgos": [], "error": str(e)}, {}
            time.sleep(2 * (i + 1))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out_dir, src_dir = Path(args[0]), Path(args[1])
    opt = lambda n, d: sys.argv[sys.argv.index(n) + 1] if n in sys.argv else d
    limit = int(opt("--limit", "0"))
    model = opt("--model", "openai/gpt-4o-mini")
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        sys.exit("falta OPENROUTER_API_KEY")

    recs = read_jsonl(out_dir / "chats.jsonl") + read_jsonl(out_dir / "docs.jsonl")
    recs += [r for r in read_jsonl(out_dir / "tables.jsonl") if r["table"] in ("clientes", "pqrs")]
    if limit:
        recs = recs[:limit]
    ents = json.loads((out_dir / "entities.json").read_text(encoding="utf-8"))["entities"]
    pseudo_by_rec = {}
    for e in ents:
        names = [v for k, v in e.get("pseudonyms", {}).items() if k == "name"]
        for rid in e.get("records", []):
            pseudo_by_rec.setdefault(rid, set()).update(names)

    # lotes de ~6.000 caracteres para que el modelo lea con atención
    batches, cur, size = [], [], 0
    for r in recs:
        t = text_of(r)
        if size + len(t) > 6000 and cur:
            batches.append(cur); cur, size = [], 0
        cur.append((r["id"], t)); size += len(t)
    if cur:
        batches.append(cur)

    def run(batch):
        pseudos = sorted({p for rid, _ in batch for p in pseudo_by_rec.get(rid, ())})
        body = "\n".join(f"<{rid}> {t}" for rid, t in batch)
        return call(model, key, PROMPT.format(pseudos=", ".join(pseudos) or "(ninguno)", records=body))

    t0 = time.time()
    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(run, batches))
    tokens_in = sum(u.get("prompt_tokens", 0) for _, u in results)
    tokens_out = sum(u.get("completion_tokens", 0) for _, u in results)
    findings = [h for res, _ in results for h in res.get("hallazgos", []) if h.get("texto")]

    # cruce contra la entrada: ¿el fragmento marcado existía tal cual en las fuentes originales?
    raw = []
    for p in src_dir.rglob("*"):
        if p.is_file() and p.suffix in (".json", ".csv", ".xml", ".md", ".html"):
            enc = "latin-1" if p.name == "clientes.csv" else "utf-8"
            raw.append(p.read_text(encoding=enc, errors="ignore"))
    raw_norm = norm("\n".join(raw))
    confirmed, false_pos = [], []
    for h in findings:
        frag = norm(h["texto"]).strip()
        digits = re.sub(r"\D", "", frag)
        in_src = (len(frag) >= 4 and frag in raw_norm) or (len(digits) >= 7 and digits in re.sub(r"(?<=\d)[.\s-](?=\d)", "", raw_norm))
        (confirmed if in_src else false_pos).append(h)

    report = {
        "modelo": model, "registros": len(recs), "lotes": len(batches), "segundos": round(time.time() - t0, 1),
        "tokens_in": tokens_in, "tokens_out": tokens_out,
        "fugas_confirmadas": confirmed, "marcados_que_son_seudonimos": len(false_pos),
        "errores": [r.get("error") for r, _ in results if r.get("error")],
    }
    out = out_dir / "auditoria.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"auditor: {len(recs)} registros en {len(batches)} lotes · {report['segundos']} s · {tokens_in}+{tokens_out} tokens")
    print(f"  marcados por el modelo: {len(findings)} · confirmados contra la entrada: {len(confirmed)} · eran seudónimos: {len(false_pos)}")
    for h in confirmed[:60]:
        print(f"  FUGA {h['id'][:14]:14} {h.get('tipo', ''):10} {h['texto']!r} — {h.get('por_que', '')}")
    print(f"reporte: {out}")


if __name__ == "__main__":
    main()
