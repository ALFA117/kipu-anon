# kipu-anon

Seudonimización determinista del corpus de soporte de Kipu Pay (Frontier CDMX/26, reto 1: *Vende los datos sin vender a la gente*).

Cada persona real se reemplaza por un seudónimo verosímil, único y estable entre corridas; el resto del texto queda byte a byte. El servicio cumple el contrato del reto: `/health`, `/run`, `/run/{job_id}`, `/output/{archivo}`, `/anonymize`, `/entities`.

**En producción:** https://kipu-anon.vercel.app (carátula con demo) · https://kipu-anon.vercel.app/v1/health (API)

**Equipo:** Edgar López Baeza ([ALFA117](https://github.com/ALFA117)) y Elizabeth Cruz ([ElizabethCruz-CM](https://github.com/ElizabethCruz-CM)).

## Correr

```bash
npm install
./run.sh                 # levanta el servicio en http://localhost:9000/v1
```

Regenerar la salida contra el API de fuentes:

```bash
curl -X POST localhost:9000/v1/run -H 'content-type: application/json' \
  -d '{"sources_url":"https://reto-pii-fuentes-production.up.railway.app/v1","token":"<token>"}'
curl localhost:9000/v1/output/chats.jsonl
```

Sin servidor, contra un directorio de fuentes ya descargado:

```bash
node scripts/run-local.js <fuentes/> output/
node scripts/check.js <fuentes/> output/ tests_public.json   # barrido de fuga + tests
OPENROUTER_API_KEY=... python -I auditor/auditor.py output/ <fuentes/>   # auditor con IA
```

## Cómo funciona

```
API de fuentes → ingesta → normalización → registro de identidades → detección por capas → reemplazo por spans → output/
```

| Archivo | Qué hace |
|---|---|
| `src/sources.js` | Baja canales, días de chat, documentos, tablas y `record_index`; compara contra la corrida anterior para detectar crecimiento de fuentes. |
| `src/parse.js` | Lleva todo al esquema de salida. PDF (texto y metadata del diccionario `/Info`, sin librerías), HTML a markdown conservando `<meta>` y comentarios, CSV Latin-1, XML. |
| `src/seed.js` | Siembra el registro con clientes, empleados y usuarios de Slack. Liga cada usuario cliente con su fila del maestro por correo, nombre exacto o evidencia en sus hilos (cédula, celular, correo, id de cliente). |
| `src/registry.js` | Personas con todas sus llaves y su seudónimo `ψ(e) = catálogo[HMAC(sal, llave estable)]`; valores falsos con formato válido que nunca coinciden con un valor real. |
| `src/anon.js` | Detección por capas sobre texto normalizado como el juez: conservados, correos (también "arroba/punto"), menciones `<@U…>`, direcciones, cédulas y celulares, fechas, placas, pasaportes, nombres del registro en cualquier forma, nombres de pila en contexto, terceros no registrados y cuasi-identificadores. |
| `src/pipeline.js` | Orquesta chats por hilo, documentos y filas; arma `entities.json` desde el mismo registro que hizo los reemplazos. |
| `src/live.js` | `/anonymize`: mismo registro, autores resueltos por nombre y llaves fuertes; personas nuevas reciben seudónimo nuevo. |
| `src/service.js` | Fastify. Igual en local y en Vercel. |
| `auditor/auditor.py` | **Auditor independiente con IA (Python).** Lee la salida ya anonimizada, le pide a un modelo que marque cualquier dato que parezca de una persona real y cruza cada hallazgo contra la entrada para separar fugas reales de seudónimos bien hechos. Así encontramos fechas de nacimiento en palabras, últimos 4 dígitos de cédula, placas en inglés y números de cuenta. |
| `auditor/adversario.py` | **Adversario con IA (Python).** Inventa mensajes de soporte diseñados para engañar al anonimizador (30 temas en dos rondas: minúsculas, inglés, parentescos, números en palabras, fincas y veredas…), cada uno con la lista exacta de datos que deben desaparecer. Los casos son inventados, no traen datos reales. |
| `scripts/check.js` | Gate antes de gastar una corrida: barrido global de fuga con la normalización del juez y tests públicos y de muestra. |

Decisiones y costo en [DECISIONS.md](DECISIONS.md).

## Estado (31-oct, 15:00)

| Revisión | Resultado |
|---|---|
| Corrida oficial 1 (versión de Elizabeth, Render) | 77 / 95 (60 % del set) |
| Corrida oficial 2 (esta versión, Vercel) | 94 / 118 (75 % del set) |
| Validador oficial | OK |
| Juez local (`npm run juez`) | 1.765 / 1.765 |
| Pruebas en vivo de `/anonymize` (`npm run live`) | 39 / 39 (incluye las 26 de la batería de Elizabeth) |
| Adversario con IA, ronda 1 / ronda 2 | 131 / 150 · 119 / 151 casos limpios (lo demás son marcas equivocadas del modelo: ciudades, montos, ids) |
| Seudónimos estables entre corridas | 206 / 206 |

## Herramientas para el equipo

Todas corren en local y **no gastan corridas oficiales**. Las que leen las fuentes necesitan `raw/full` y `.env` (no se suben al repo porque traen datos personales y llaves).

| Comando | Para qué |
|---|---|
| `npm run juez` | Juez local: 1.700+ casos generados de los datos reales en 7 familias (directa, oculta, indirecta, falso positivo, homónimos, consistencia, en vivo), con reporte estilo Frontier. |
| `npm run live -- https://kipu-anon.vercel.app/v1 output` | Las 39 pruebas en vivo contra cualquier despliegue. |
| `npm run eval -- --nota "qué cambié"` | Nota estricta con la forma de la rúbrica (fuga 45 · utilidad 35 · consistencia 20) y una fila en `evals/HISTORIAL.md`. |
| `node scripts/cruce.js raw/full output <otra-salida>` | Compara dos versiones registro por registro: qué detecta cada una que la otra no. Sirve para ver que un cambio no rompa nada. |
| `python -I auditor/adversario.py --n 150 [--ronda2]` y `node scripts/adversario-run.js <casos.json>` | Genera casos difíciles con IA y mide qué se escapa. |
| `npm run watch` | Vigila el API de fuentes y avisa cuando crece (el incidente). |
| `npm run post-incident` | Ensayo local con las fuentes nuevas: compara, corre el evaluador y revisa que los seudónimos viejos no cambien. |

## Qué cambió en la tarde

- **Homónimos:** los usuarios del chat se ligan a su fila del maestro comparando toda la evidencia (cédula, id, radicado PQR, montos, barrio); una mención junto a un radicado o id elige a la persona correcta; empleado y cliente con el mismo nombre se separan por el contexto.
- **Formas escondidas:** iniciales con apellido ("A. Marulanda"), usuarios en links y @handles, nombres en archivos, apodos al firmar, parentescos ("mi hermano Daniel"), nombres después de "soy / me llamo / my name is / a nombre de" en cualquier formato, saludos y firmas, cédulas y celulares con separadores raros o en palabras, fechas de nacimiento en todos los formatos, cuentas, DNI/PEP, fincas y veredas.
- **Errores corregidos:** los emojis corrían las posiciones del texto (86 mensajes); un disfraz podía repetir el nombre real; un nombre podía tragarse el cargo de la línea siguiente.
- **Privacidad del API:** `/anonymize` solo devuelve los datos originales que venían en lo que se mandó, nunca datos del corpus de otra persona.
- **Estabilidad:** el mapa de seudónimos solo crece, así nadie cambia de disfraz cuando lleguen datos nuevos.

Aportes de Elizabeth: iniciales con apellido, pistas "soy / me llamo" e "ID", y la batería de 27 pruebas manuales que ahora son pruebas fijas.

## DESIGN_NOTES

- Sistema de diseño de UI/UX Pro Max (`design-system/kipu-anon/MASTER.md`): Dark Mode OLED, "code dark + run green", JetBrains Mono. Se adaptó con un rojo para "dato real" y verde para "seudónimo", que es la idea del producto.
- Fondo: salió la receta 6 (malla low-poly con Three.js). La carátula es HTML estático sin bundler, así que se hizo la malla a mano en canvas 2D: un icosaedro subdividido que gira, con partículas rojas que lo atraviesan y salen verdes. Dos capas con parallax distinto (puntero y scroll), mitad de elementos en móvil, pausa con la pestaña oculta y cuadro fijo con `prefers-reduced-motion`.
- La carátula solo se sirve a navegadores (`Accept: text/html`); el API sigue respondiendo JSON en `/` y `/v1`.
- La terminal del hero hace una llamada real a `/v1/anonymize`; las métricas dicen de dónde salen.

## Probar en el celular (2 minutos)

1. Abre https://kipu-anon.vercel.app y espera el punto verde "en línea".
2. Baja a la demo, toca "Anonimizar" y revisa que la tabla muestre original tachado y seudónimo en verde.
3. Toca los tres ejemplos; "falsos positivos" debe dejar Shakira, Carulla y Nequi intactos.
4. Gira el teléfono: no debe haber scroll horizontal.

## Cómo proponer cambios (equipo)

`master` está protegida: todo cambio entra por Pull Request con una aprobación.

1. Crea una rama: `git checkout -b mejora-landing`.
2. Haz tus cambios. La carátula vive en `public/index.html`.
3. Si tocaste `src/`, corre la evaluación local y anota qué cambiaste: `npm run eval -- --nota "qué cambié"`. Necesita las fuentes en `raw/full`, que no se suben al repo porque traen datos personales.
4. Abre el PR. Al aprobarlo se despliega a https://kipu-anon.vercel.app.

## Evaluación local (sin gastar corridas oficiales)

```bash
npm run eval -- --nota "qué cambié"      # corre todo y agrega una fila a evals/historial.jsonl
npm run eval:tabla                       # muestra el historial (también en evals/HISTORIAL.md)
node scripts/eval-local.js --oficial 94/118 --set 75 --nota "corrida 2"   # anota una corrida oficial
```

Cada corrida local revisa: validador oficial, barrido de fuga con la normalización del juez, tests públicos y de muestra, 39 pruebas en vivo que imitan al jurado, consistencia por persona (185 personas del maestro) y estabilidad de los seudónimos contra el mapa persistido.

**Nunca subas al repo** `raw/`, `fuentes/`, `output/`, `evals/out_*` ni nada que traiga `entities.json` con `originals`: son datos personales reales.
