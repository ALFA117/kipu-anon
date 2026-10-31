# DECISIONS

## 1. Qué consideramos PII

- **Identificadores directos:** nombre de persona natural en cualquier forma (completo, nombre + apellido, nombre de pila en contexto, MAYÚSCULAS SIN TILDES, `nombre_apellido` en archivos, handles `nombre.apellido`, menciones `<@UID>`), cédula con y sin puntos (también pegada a texto, como `CC1022649507_…`), celular, correo (también deletreado con "arroba" y "punto"), dirección, fecha de nacimiento, placa y pasaporte.
- **Dónde se esconden:** texto de chats, nombres de adjuntos, cuerpo, título, nombre de archivo y metadata de documentos (`author` de PDF, `<meta>` de HTML, front matter), comentarios HTML y columnas de las tablas.
- **Cuasi-identificadores:** ocupación, barrio y año de vinculación. En `clientes.csv` la ocupación pasa a sector y el barrio a otro barrio de la misma ciudad. En texto, la ocupación pasa a sector, el barrio a su ciudad y el año de vinculación a "hace unos años". Los cargos de empleados con mayúscula ("Contadora") se conservan.

## 2. Qué conservamos a propósito y por qué

- **Organizaciones, lugares, marcas y figuras públicas** (Bancolombia, Nequi, Superfinanciera, Carulla, Plaza Botero, Shakira…): no son personas naturales y el comprador los necesita. Se declaran `kept: true`. Un apellido que también es lugar o marca ("Santander", "Carulla") se reemplaza cuando nombra a una persona: gana el span más largo.
- **Datos de negocio:** montos, fechas de transacción, productos y los ids `CL-`, `TX-`, `PQR-`, `KP-`. No identifican solos y sostienen los joins entre tablas.
- **El texto alrededor:** se reemplazan spans, no se reescribe. Así el parecido con la salida ideal se mantiene y no se inventan ni se borran datos de negocio.
- **Ciudad y fecha de vinculación** en la tabla de clientes, como en la salida ideal de la muestra.

## Por qué el motor es por reglas y el auditor usa IA

El motor tiene que ser determinista: la misma persona debe recibir el mismo seudónimo en cada corrida y después de que crezcan las fuentes. Un modelo no garantiza eso. El modelo sí sirve para lo que las reglas no conocen, así que lo usamos como **auditor independiente** (`auditor/auditor.py`, Python): no ve los datos originales ni el código del motor, solo la salida. Sus hallazgos se confirman contra la entrada y se convierten en reglas nuevas. En la primera auditoría encontró fechas de nacimiento escritas en palabras ("4 de marzo de 1979"), últimos 4 dígitos de cédula en la verificación de identidad, placas en mensajes en inglés y números de cuenta; las cuatro quedaron cubiertas.

## 3. Costo

- **Tokens de LLM del pipeline:** 0. El núcleo es por reglas y el registro de identidades.
- **Auditor con IA:** unos 170 mil tokens de entrada y 60 mil de salida con `openai/gpt-4o-mini` por pasada completa (2.231 registros, unos 2 minutos, menos de US$0,10). Corre fuera del servicio, antes de cada corrida. En la tarde también se corrió con `openai/gpt-4.1` (unos 170 mil + 24 mil tokens, menos de un minuto).
- **Adversario con IA:** 4 rondas, unos 630 casos inventados con `gpt-4o-mini` y `gpt-4.1`. Todo lo de IA del día costó menos de US$1.
- **Tiempo:** la ingesta tarda unos 2–4 s y el pipeline 1,1–1,7 s para 8.297 registros. Después del incidente (10.856 registros), un `/run` completo en Vercel tarda unos 5,5 s. `/anonymize` responde en milisegundos con el estado en memoria y en unos 3 s en una instancia fría de Vercel.
- **Infraestructura:** Vercel Hobby (gratis).

## Consistencia entre corridas

`ψ` depende solo de la llave estable de la persona (`cliente_id`, id de empleado, uid o nombre normalizado de un tercero) y de una sal. Los seudónimos de la corrida anterior se guardan en `data/pseudonyms.json` con las llaves hasheadas, para no publicar nombres reales, y se reservan antes de asignar los nuevos. El mapa solo crece: una persona que no aparece en una corrida conserva su seudónimo para cuando vuelva. Así una persona vieja conserva su seudónimo cuando las fuentes crecen. Un seudónimo nunca repite un nombre o apellido de la persona real.

## El incidente (Kipu Pay compró Págalo)

A las 15:45 las fuentes crecieron a 2.999 mensajes, 34 documentos y 7.823 filas. Los clientes migrados llegan a `clientes.csv` con un id nuevo (`PG-…`) y la misma cédula que su fila `CL-`: es la misma persona, así que se liga por cédula y conserva el seudónimo de la fila vieja; el `PG-` también sirve para resolver menciones en el texto. Una persona nueva que se llama igual que una vieja, con otra cédula, es otra persona. Antes de proponer la corrida se comparó contra el `entities.json` de la última corrida antes del cambio: las 193 personas conservan exactamente su seudónimo.

## Homónimos

Nunca se une por nombre. Un usuario del chat se liga a su fila del maestro comparando toda la evidencia disponible (lo que escribe el propio usuario pesa tres veces más que lo que dice el hilo): cédula, correo, celular, id de cliente, radicado PQR, montos de sus transacciones, barrio, ciudad y ocupación. Las parejas se asignan de mayor a menor evidencia. En el texto, una mención ambigua se resuelve por el id o radicado más cercano (en una tabla, el de la misma fila) y por el rol: un cargo cerca apunta al empleado; "cliente", "crédito" o "cuota", al cliente. En vivo, un nombre conocido con una cédula distinta es otra persona; con un correo o celular nuevo, es la misma.

## Privacidad del propio servicio

`/anonymize` devuelve las entidades que intervinieron, pero solo con las formas originales que venían en el lote recibido. Nunca devuelve cédula, celular o fecha de nacimiento del corpus que el que llama no mandó. `entities.json` completo solo sale por `/entities` y `/output`, que son para el jurado.

## Cómo se prueba

Además del validador oficial y los tests públicos, el repo trae un juez local que genera 1.700+ casos de los datos reales con las familias del set oculto, 39 pruebas en vivo (incluida la batería manual de Elizabeth), una nota estricta con la forma de la rúbrica, un cruce registro por registro entre versiones para detectar regresiones y falsos positivos, un auditor y un adversario con IA en Python. Ningún cambio se despliega si el cruce muestra datos alterados que no debían cambiar.
