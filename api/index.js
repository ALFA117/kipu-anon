// Entrada de Vercel: todas las rutas llegan aquí (ver vercel.json) y las atiende Fastify.
import { app } from '../src/service.js';

export default async function handler(req, res) {
  await app.ready();
  app.server.emit('request', req, res);
}
