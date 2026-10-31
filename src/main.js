// Arranque local: node src/main.js  (PORT=9000 por defecto)
import { app, ensureState } from './service.js';

const port = +(process.env.PORT || 9000);
app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`kipu-anon escuchando en http://localhost:${port}/v1`);
  ensureState().catch(e => console.error('estado inicial:', e.message));
});
