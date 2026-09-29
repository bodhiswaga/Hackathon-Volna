import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController } from 'fastify';
import { ZodError } from 'zod';
import { ChangeSetError } from '@volna/engine';
import { HttpError } from './errors';
import { projectRoutes } from './routes/projects';
import { demoIsStale, seedDemo } from './seed';

// Логи запросов отключены: во время демо они засоряют терминал.
const app = Fastify({
  logger: { level: 'info' },
  trustProxy: true,
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

app.addHook('onSend', async (_req, reply) => {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('x-frame-options', 'SAMEORIGIN');
  reply.header('referrer-policy', 'strict-origin-when-cross-origin');
});

app.get('/api/health', async () => ({ ok: true }));
await app.register(projectRoutes);

// Логи — на английском: консоль Windows (cp866) искажает кириллицу из JSON-логов.

// Продакшн-режим: собранный фронтенд раздаётся тем же сервером (маршрутизация на клиенте — через hash).
const webDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
const servesWeb = existsSync(webDist);
if (servesWeb) {
  await app.register(fastifyStatic, {
    root: webDist,
    cacheControl: false,
    // Файлы в assets/ с хэшем в имени кэшируются навсегда, index.html — всегда свежий.
    setHeaders: (reply, path) => {
      const hashed = /[\\/]assets[\\/]/.test(path);
      reply.header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  app.log.info('Serving built web app from apps/web/dist');
}

// Демо общий для всех посетителей: создаём при первом запуске и пересоздаём, когда он устарел
// (наступил новый день или правки давно брошены).
function refreshDemo() {
  try {
    if (!demoIsStale()) return;
    seedDemo();
    app.log.info('Demo project (re)created');
  } catch (err) {
    app.log.error(err);
  }
}
refreshDemo();
setInterval(refreshDemo, 10 * 60 * 1000).unref();

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
