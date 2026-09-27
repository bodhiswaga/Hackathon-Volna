import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController } from 'fastify';
import { ZodError } from 'zod';
import { ChangeSetError } from '@volna/engine';
import { HttpError } from './errors';
import { listProjects } from './repo';
import { projectRoutes } from './routes/projects';
import { seedDemo } from './seed';

// Логи запросов отключены: во время демо они засоряют терминал.
const app = Fastify({
  logger: { level: 'info' },
  logController: new LogController({ disableRequestLogging: true }),
});

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

// Логи — на английском: консоль Windows (cp866) искажает кириллицу из JSON-логов.

// Продакшн-режим: собранный фронтенд раздаётся тем же сервером (маршрутизация на клиенте — через hash).
const webDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
const servesWeb = existsSync(webDist);
if (servesWeb) {
  await app.register(fastifyStatic, { root: webDist });
  app.log.info('Serving built web app from apps/web/dist');
}

// Первый запуск: чтобы было что показать, создаём демо-проект.
if (listProjects().length === 0) {
  seedDemo();
  app.log.info('Demo project created');
}

const port = Number(process.env.PORT ?? 3001);
try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(
      `\nPort ${port} is already in use: another Volna server (npm run dev / npm start) is probably running.\n` +
        `Stop it, or start on another port: PORT=3002 (cmd: "set PORT=3002 && npm start", PowerShell: "$env:PORT=3002; npm start").\n`,
    );
    process.exit(1);
  }
  throw err;
}
if (servesWeb) console.log(`\nVolna is ready: http://localhost:${port}\n`);
