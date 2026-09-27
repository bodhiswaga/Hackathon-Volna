import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { ChangeSetError } from '@volna/engine';
import { HttpError } from './errors';
import { listProjects } from './repo';
import { projectRoutes } from './routes/projects';
import { seedDemo } from './seed';

const app = Fastify({ logger: { level: 'info' } });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'validation', message: err.issues[0]?.message ?? 'Некорректные данные', details: err.issues },
    });
  }
  if (err instanceof ChangeSetError) {
    return reply
      .code(err.code === 'not_found' ? 404 : 400)
      .send({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof HttpError) {
    return reply
      .code(err.status)
      .send({ error: { code: err.code, message: err.message, details: err.details } });
  }
  app.log.error(err);
  return reply.code(500).send({ error: { code: 'internal', message: 'Внутренняя ошибка сервера' } });
});

app.get('/api/health', async () => ({ ok: true }));
await app.register(projectRoutes);

// Продакшн-режим: собранный фронтенд раздаётся тем же сервером (маршрутизация на клиенте — через hash).
const webDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.log.info(`Раздаю фронтенд из ${webDist}`);
}

// Первый запуск: чтобы было что показать, создаём демо-проект.
if (listProjects().length === 0) {
  seedDemo();
  app.log.info('Создан демо-проект');
}

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
