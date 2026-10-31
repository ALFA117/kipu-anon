# Reto 1 · Kipu Pay — Systems design

Equipo: Edgar · Frontier CDMX/26 · 31-oct-2026

## 1. El problema en una línea

Convertir 8.297 registros (2.028 mensajes de Slack en 6 canales, 26 documentos PDF/HTML/MD, 6.243 filas de 4 tablas) en un corpus vendible: **cada persona real sustituida por un seudónimo verosímil, estable y único**, sin tocar el negocio (montos, productos, fechas, bancos, lugares, marcas), servido como API HTTP que regenera `output/` y anonimiza en vivo.

## 2. Lo que decide el diseño

| Hecho del enunciado | Consecuencia |
|---|---|
| Jurado automático: fuga 45, utilidad 35, consistencia 20. "Una solución sólida por reglas da ~88". | Núcleo **determinista por reglas**; el LLM solo cubre la cola larga (terceros nombrados en texto libre). |
| Barrido global de todas las formas reales: tolera confusables, separadores e invisibles. | Sustituir, nunca deformar. Normalizar (sin tildes, minúsculas, sin separadores) antes de buscar. |
| El desempate de homónimas "vive en otra fuente: un radicado, una fecha y un monto, un adjunto, una fila del maestro". | Resolución de entidades por **llaves fuertes** cruzando fuentes, no por nombre. |
| Una agente se llama igual que una clienta. | El rol (agente vs. cliente) y el uid de Slack separan identidades. |
| Las fuentes **crecen a mitad del día** sin aviso; la última corrida antes vale 30 %, la última después 70 %; los seudónimos viejos deben sobrevivir. | Seudónimos **deterministas** (HMAC de una llave estable) + mapa persistido. **Corrida 1 antes del incidente de las 15:00.** |
| `entities.json` se mide contra la verdad ("honestidad", 3 pts) y el validador revisa que cada original declarado ya no esté en la salida. | El diccionario sale del mismo registro que hace los reemplazos: una sola fuente de verdad. |
| Reescribir con un modelo pierde parecido con la salida ideal. | Reemplazo **in situ por spans**; el texto alrededor queda byte a byte. |

## 3. Arquitectura

```
                 ┌──────────────── POST /run ────────────────┐
API de fuentes ─►│ 1 Ingesta ─► 2 Normalización ─► 3 Registro │─► 4 Detección ─► 5 Reemplazo ─► 6 Cuasi-ids ─► output/ (4 archivos)
                 └────────────────────────────────────────────┘          ▲                                     │
                                       mapa de seudónimos persistido ────┴──── POST /anonymize (lotes ≤50) ◄──┘
```

**1. Ingesta.** Descarga paralela (≤600 req/min) de canales, usuarios, días de chat, documentos, tablas y `record_index`. Esquema tolerante: canales, fechas, documentos y filas nuevos entran sin cambiar código.

**2. Normalización al esquema de salida.**
- Chats: `id = client_msg_id`, `thread_id = <canal>:<ts del primer mensaje>`, `author` = nombre del uid, adjuntos como `{filename}`.
- Documentos: PDF → texto + metadata (`author`, `subject`, `keywords`…); HTML → markdown conservando `<meta>` y comentarios `<!-- -->`; MD con front matter intacto.
- Tablas: `clientes.csv` en Latin-1 con `;`, `transacciones.csv` en UTF-8, XML a columnas planas. Ids `<tabla>:<llave>`.

**3. Registro de identidades (el corazón).**
- Semillas: `clientes.csv` (149), `empleados.xml` (36, con `reporta_a`), `users.json` de Slack.
- Cada persona: `entity_id` estable, género, rol (cliente/empleado/tercero) y todas sus formas: nombre completo, variantes (nombre + primer apellido, MAYÚSCULAS SIN TILDES, `nombre_apellido` de archivos, `nombre.apellido` de correos y handles), cédula con y sin puntos, correo, celular, dirección, fecha de nacimiento, placa, pasaporte, cuenta.
- Enlace mensaje→cliente: los usuarios de Slack no traen `customer_id` ni celular, así que se enlazan por los datos que el propio cliente o el agente escriben en el hilo (cédula, correo, celular, radicado PQR, fecha + monto de una transacción).
- Homónimas: nunca se fusionan por nombre; se desempatan con esas llaves fuertes. Si no hay desempate, la mención queda con la persona del hilo.

**4. Detección por capas.**
1. Registro: Aho-Corasick sobre texto normalizado con todas las formas conocidas → cubre mayúsculas sin tildes, nombres en archivos, handles y correos.
2. Patrones: correo (también `arroba`/`punto`), celular CO, cédula con/sin puntos, NIT, tarjeta (Luhn), cuenta, placa (`ABC123`, `ABC12D`), pasaporte, dirección (`Calle/Cra/Av … # …-…`), fecha de nacimiento. Lo que encuentren y no esté en el registro crea un tercero.
3. Estructura: metadata de PDF, `<meta>` HTML, comentarios HTML, front matter, menciones `<@U…>` de Slack, nombres de archivo y adjuntos.
4. LLM (OpenRouter, modelo barato, JSON de spans verificados literalmente) solo para nombres de terceros en texto libre que las capas 1–3 no reconocen. Lista blanca de bancos, billeteras, reguladores, comercios, lugares y figuras públicas (Bancolombia, Nequi, Superfinanciera, Carulla, Plaza Botero, Shakira…) que se conservan y se declaran `kept: true`.

**5. Reemplazo con forma preservada.**
- Seudónimo = `HMAC(sal, llave estable)` → nombre y apellidos colombianos del mismo género, únicos en todo el corpus y lejos del original.
- Se renderiza con la forma de la mención: solo nombre, nombre + apellido, completo, mayúsculas sin tildes, `nombre_apellido`, handle.
- Derivados coherentes: correo del seudónimo (mismo dominio si es `kipupay.co` o genérico), celular `3XX` con el mismo formato, cédula con la misma longitud y los mismos puntos, placa y pasaporte con formato válido, dirección verosímil, fecha de nacimiento desplazada.
- Llaves de negocio intactas (`CL-…`, `TX-…`, `PQR-…`, `KP-…`) para que las tablas sigan uniéndose; `reporta_a` se conserva.

**6. Cuasi-identificadores.** Se calcula k-anonimato de (barrio, ocupación, año) sobre la unión de `clientes.csv` y los chats. Donde k = 1 se generaliza en **todas** las fuentes: barrio → ciudad, ocupación → sector ("periodista" → "profesional de medios"), año → "hace unos años". Lo demás queda intacto.

## 4. Servicio

FastAPI, raíz `/v1`, sin autenticación.

| Ruta | Implementación |
|---|---|
| `GET /health` | `{status, team, version, models}` |
| `POST /run` | job en segundo plano: ingesta → pipeline → `output/`; idempotente. Objetivo < 10 min (límite 2 h). |
| `GET /run/{job_id}` | estado, conteos, tokens y segundos |
| `GET /output/{archivo}` | los cuatro archivos de la última corrida terminada |
| `POST /anonymize` | mismo pipeline sobre el lote con el registro cargado: personas conocidas → mismo seudónimo; nuevas → seudónimo nuevo determinista; capas 1–3 instantáneas, LLM con timeout. < 60 s. |
| `GET /entities` | diccionario de la última corrida |

Despliegue: contenedor en Railway (proceso persistente y disco para el mapa de seudónimos). Plan B: el servicio en esta máquina detrás de un túnel de Cloudflare. Entrega: repo con `run.sh`, `DECISIONS.md` y demo de 5 minutos.

## 5. Verificación antes de gastar una corrida

1. `node validar.mjs output/ --public fuentes/` → OK.
2. Barrido propio de fuga: toda forma original del registro, normalizada, buscada en toda la salida → 0 coincidencias.
3. Los 5 tests públicos y los 13 de la muestra (el mismo pipeline corrido sobre `sample/input` comparado contra `expected_output`).
4. Lista blanca: los falsos positivos siguen presentes.

## 6. Plan del día

| Hora | Hito |
|---|---|
| 12:00 | Diseño entregado. Ingesta y normalización con los 8.297 ids pasando el validador. |
| 13:30 | Registro de identidades + patrones + reemplazo determinista; barrido de fuga en 0. |
| 14:30 | Servicio desplegado; **corrida 1 (60 %) antes de las 15:00**. |
| 15:00 | Incidente (crecimiento de fuentes): regenerar, verificar que los seudónimos viejos no cambian. |
| 16:30 | LLM para terceros, cuasi-identificadores, `DECISIONS.md`. Corrida 2 (75 %). |
| 17:45 | Corrida 3 (100 %). Cierre duro a las 18:00. |

## 7. Riesgos

- **Homónimas y la agente homónima de una clienta**: si se resuelven mal se pierden puntos de fuga y de consistencia a la vez. Mitigación: llaves fuertes y rol.
- **Apellidos que son lugares** (Santander, Bolívar…): se reemplazan cuando nombran a una persona registrada; si no, se conservan.
- **Que la corrida 1 no llegue antes del cambio de fuentes**: perderíamos el 30 % del total. El MVP por reglas se despliega primero; el LLM llega después.
- **Costo del LLM**: presupuesto de US$45; ~435 mil tokens de corpus y el LLM solo sobre el texto libre que lo necesita.
