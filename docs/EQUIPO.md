# Guía del equipo de kipu-anon

[← Volver al README](../README.md)

Herramientas locales, historial de cambios y notas de diseño. Se movió aquí desde el README principal sin cambios de contenido.

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
| `node scripts/simular-incidente.js [entities.json de referencia]` | Simula el incidente con datos inventados (canal, documentos y filas nuevas; personas nuevas, una homónima, un tercero y un cliente viejo con correo nuevo) y revisa estabilidad, fuga, unicidad y validador. |
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
