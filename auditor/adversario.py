"""Adversario con IA (Python, solo librería estándar).

Le pide a un modelo que invente mensajes de soporte de una fintech colombiana con datos personales
escondidos de formas difíciles, y que devuelva para cada uno la lista exacta de datos que deben
desaparecer y la de palabras que deben quedarse. Los casos son inventados: no contienen datos reales.

uso: python -I auditor/adversario.py [--n 120] [--salida evals/adversario-casos.json] [--ronda2|--ronda3] [--model openai/gpt-4o-mini]
Necesita OPENROUTER_API_KEY.
"""
import json
import os
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

TEMAS_3 = [
    "clientes que vienen de otra fintech (Págalo) recién comprada: migración de cuentas, ids viejos y nuevos, datos repetidos",
    "exportes de otro sistema: líneas tipo log o CSV pegadas en el chat con nombre;cédula;correo;celular",
    "actas y correos de la integración entre dos empresas con nombres de empleados de ambas, cargos y firmas",
    "clientes que cambian de correo, celular o dirección y dan el viejo y el nuevo en el mismo mensaje",
    "dos personas con el mismo nombre en el mismo hilo, distinguidas por cédula o ciudad",
    "plantillas de cartas y notificaciones con campos llenos (Estimado/a NOMBRE, CC, dirección, saldo)",
    "JSON o XML pegado en un mensaje con campos nombre, documento, email, telefono, direccion",
    "notas de voz transcritas: números dictados, nombres deletreados letra por letra",
]

TEMAS_2 = [
    "conversaciones de varios mensajes entre agente y cliente donde el agente repite datos del cliente",
    "notas internas de empleados sobre clientes con nombres, cédulas y celulares",
    "extractos bancarios y comprobantes copiados como texto plano o tabla",
    "mensajes con errores de ortografía, sin tildes y abreviaciones (q, xq, tmb, cel, cc)",
    "nombres de personas dentro de correos corporativos, firmas de correo y cadenas reenviadas",
    "datos de terceros: beneficiarios, codeudores, referencias personales y familiares",
    "números escritos con palabras o mezclados (tres uno cero..., 3 1 0 5 5 5...)",
    "nombres extranjeros, dobles apellidos con guion y nombres indígenas o afro colombianos",
    "mensajes que mencionan figuras públicas, políticos, artistas y marcas junto a clientes reales",
    "direcciones rurales, veredas, fincas, conjuntos residenciales, torres y apartamentos",
    "datos de vehículos, motos, SOAT, licencias de conducción y matrículas",
    "documentos de identidad extranjeros: cédula de extranjería, PEP, PPT, DNI, pasaportes",
    "redes sociales: Instagram, TikTok, X, Facebook, WhatsApp con usuario o número",
    "historias clínicas, incapacidades y certificados laborales con nombre del médico o jefe",
    "mensajes donde un apellido es también nombre de lugar o empresa y se usa como persona",
]

TEMAS = [
    "nombres en minúsculas, MAYÚSCULAS sin tildes o con apodos", "correos deletreados o con espacios raros",
    "cédulas y celulares con separadores raros (puntos, espacios, guiones, +57)", "nombres dentro de URLs, adjuntos y @usuarios",
    "terceros: familiares, socios, vecinos, empleadores, con y sin apellido", "fechas de nacimiento en todos los formatos",
    "placas de carro y moto, pasaportes, números de cuenta y tarjeta", "direcciones colombianas en todas sus variantes",
    "mensajes en inglés o spanglish", "firmas al final, saludos y despedidas con nombre",
    "nombres que también son lugares o marcas (Santander, Bolívar, Carulla) usados como persona y como lugar",
    "marcas, bancos, lugares y figuras públicas que NO deben cambiar", "combinaciones de oficio + barrio + año que identifican",
    "datos repartidos en varias líneas o en tablas markdown", "nombres compuestos con partículas (de, del, de la, y)",
]

PROMPT = """Genera {k} mensajes realistas y DIFÍCILES de soporte de una fintech colombiana (Kipu Pay), enfocados en: {tema}.
Todos los datos son inventados. Cada mensaje debe esconder datos personales de forma que un anonimizador por reglas pueda fallar.

Devuelve SOLO JSON: {{"casos": [{{"texto": "...", "debe_desaparecer": ["fragmento exacto 1", ...], "debe_quedar": ["fragmento exacto", ...]}}]}}
- "debe_desaparecer": cada dato personal tal como aparece en el texto (nombres y apellidos de personas privadas, cédulas, celulares, correos, usuarios, placas, pasaportes, cuentas, direcciones, fechas de nacimiento). Fragmentos cortos y exactos.
- "debe_quedar": bancos, marcas, comercios, ciudades, entidades públicas, figuras públicas y montos que aparezcan (exactos). Puede ir vacío.
- No marques como dato personal: Kipu, Kipi (el bot), montos, fechas de transacción, radicados (PQR-2026-0451), ids (CL-12345, TX-000123)."""


def call(key, prompt, model="openai/gpt-4o-mini"):
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}],
                       "temperature": 0.9, "response_format": {"type": "json_object"}}).encode()
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=body,
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "X-Title": "kipu-anon adversario"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            content = json.loads(r.read())["choices"][0]["message"]["content"]
        m = re.search(r"\{.*\}", content, re.S)
        return json.loads(m.group(0) if m else content).get("casos", [])
    except Exception as e:
        print("error:", e, file=sys.stderr)
        return []


def main():
    opt = lambda n, d: sys.argv[sys.argv.index(n) + 1] if n in sys.argv else d
    n = int(opt("--n", "120"))
    out = opt("--salida", "evals/adversario-casos.json")
    key = os.environ.get("OPENROUTER_API_KEY") or sys.exit("falta OPENROUTER_API_KEY")
    temas = TEMAS_3 if "--ronda3" in sys.argv else TEMAS_2 if "--ronda2" in sys.argv else TEMAS
    model = opt("--model", "openai/gpt-4o-mini")
    per = max(4, n // len(temas))
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda t: [dict(c, tema=t) for c in call(key, PROMPT.format(k=per, tema=t), model)], temas))
    casos = [c for lote in res for c in lote if c.get("texto")]
    # solo fragmentos que de verdad están en el texto
    for c in casos:
        c["debe_desaparecer"] = [x for x in c.get("debe_desaparecer", []) if x and x in c["texto"]]
        c["debe_quedar"] = [x for x in c.get("debe_quedar", []) if x and x in c["texto"]]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(casos, f, ensure_ascii=False, indent=1)
    print(f"{len(casos)} casos en {out}")


if __name__ == "__main__":
    main()
