import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  analyze,
  applyChangeSet,
  summarizeOps,
  type ChangeOp,
  type Person,
  type ProjectState,
} from '@volna/engine';
import { todayISO, transaction } from '../db';
import * as repo from '../repo';
import {
  changeBodySchema,
  createProjectSchema,
  personPatchSchema,
  personSchema,
  updateProjectSchema,
} from '../schemas';
import { DEMO_PROJECT_ID, seedDemo } from '../seed';
import { HttpError } from '../errors';

/** Сайт публичный и без авторизации: ограничиваем число проектов, чтобы базу не засорили. */
const MAX_PROJECTS = 50;

const PALETTE = ['#6366f1', '#ec4899', '#0ea5e9', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#14b8a6'];

function mustLoad(id: string): ProjectState {
  const state = repo.loadState(id);
  if (!state) throw new HttpError(404, 'not_found', 'Проект не найден');
  return state;
}

/** Сохраняет новое состояние и пишет запись в журнал (всё в одной транзакции). */
function commit(
  before: ProjectState,
  after: ProjectState,
  title: string,
  reason: string | null,
  ops: ChangeOp[],
): repo.ChangeEvent {
  const today = todayISO();
  const a0 = analyze(before, today);
  const a1 = analyze(after, today);
  const event: repo.ChangeEvent = {
    id: randomUUID(),
    projectId: before.project.id,
    createdAt: new Date().toISOString(),
    title,
    reason,
    ops,
    finishBefore: a0.finishDate,
    finishAfter: a1.finishDate,
    bufferBefore: a0.bufferDays,
    bufferAfter: a1.bufferDays,
  };
  transaction(() => {
    repo.updateProject(after.project);
    repo.replaceTasksAndDeps(after);
    repo.insertChangeEvent(event, {
      project: before.project,
      tasks: before.tasks,
      dependencies: before.dependencies,
    });
  });
  return event;
}

export async function projectRoutes(app: FastifyInstance) {
  app.get('/api/projects', async () => {
    const today = todayISO();
    return repo.listProjects().map((project) => {
      const state = repo.loadState(project.id)!;
      const a = analyze(state, today);
      return {
        project,
        health: a.health,
        finishDate: a.finishDate,
        bufferDays: a.bufferDays,
        stats: a.stats,
        peopleCount: state.people.length,
      };
    });
  });

  app.post('/api/projects', async (req, reply) => {
    const body = createProjectSchema.parse(req.body);
    if (repo.listProjects().length >= MAX_PROJECTS) {
      throw new HttpError(400, 'limit', `Достигнут предел в ${MAX_PROJECTS} проектов — удалите ненужные`);
    }
    const project = {
      id: randomUUID(),
      name: body.name,
      description: body.description,
      startDate: body.startDate,
      deadline: body.deadline,
      statusDate: null,
      createdAt: new Date().toISOString(),
    };
    repo.insertProject(project);
    reply.code(201);
    return mustLoad(project.id);
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => mustLoad(req.params.id));

  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const state = mustLoad(req.params.id);
    const patch = updateProjectSchema.parse(req.body);
    repo.updateProject({ ...state.project, ...patch });
    return mustLoad(req.params.id);
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    mustLoad(req.params.id);
    if (req.params.id === DEMO_PROJECT_ID) {
      throw new HttpError(403, 'forbidden', 'Демо-проект нельзя удалить — его можно сбросить в меню проекта');
    }
    repo.deleteProject(req.params.id);
    reply.code(204);
  });

  // --- Люди ---
  app.post<{ Params: { id: string } }>('/api/projects/:id/people', async (req, reply) => {
    const state = mustLoad(req.params.id);
    const body = personSchema.parse(req.body);
    const person: Person = {
      id: randomUUID(),
      projectId: state.project.id,
      name: body.name,
      role: body.role,
      color: body.color ?? PALETTE[state.people.length % PALETTE.length],
    };
    repo.insertPerson(person, state.people.length);
    reply.code(201);
    return person;
  });

  app.patch<{ Params: { id: string; personId: string } }>(
    '/api/projects/:id/people/:personId',
    async (req) => {
      const state = mustLoad(req.params.id);
      const person = state.people.find((p) => p.id === req.params.personId);
      if (!person) throw new HttpError(404, 'not_found', 'Человек не найден');
      const next = { ...person, ...personPatchSchema.parse(req.body) };
      repo.updatePerson(next);
      return next;
    },
  );

  app.delete<{ Params: { id: string; personId: string } }>(
    '/api/projects/:id/people/:personId',
    async (req, reply) => {
      const state = mustLoad(req.params.id);
      if (!state.people.some((p) => p.id === req.params.personId)) {
        throw new HttpError(404, 'not_found', 'Человек не найден');
      }
      repo.deletePerson(req.params.personId);
      reply.code(204);
    },
  );

  // --- Изменения (ChangeSet) и журнал ---
  app.post<{ Params: { id: string } }>('/api/projects/:id/changes', async (req) => {
    const before = mustLoad(req.params.id);
    const body = changeBodySchema.parse(req.body);
    const ops = body.ops as ChangeOp[];
    const after = applyChangeSet(before, ops);
    const title = body.title?.trim() || summarizeOps(before, ops) || 'Изменение плана';
    const event = commit(before, after, title, body.reason?.trim() || null, ops);
    return { state: mustLoad(req.params.id), event };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/changes', async (req) => {
    mustLoad(req.params.id);
    return repo.listChangeEvents(req.params.id);
  });

  app.post<{ Params: { id: string; eventId: string } }>(
    '/api/projects/:id/changes/:eventId/revert',
    async (req) => {
      const current = mustLoad(req.params.id);
      const found = repo.getSnapshot(req.params.id, req.params.eventId);
      if (!found) throw new HttpError(404, 'not_found', 'Запись журнала не найдена');
      const peopleIds = new Set(current.people.map((p) => p.id));
      const restored: ProjectState = {
        project: found.snapshot.project,
        people: current.people,
        // Люди могли быть удалены после снимка — такие назначения снимаем.
        tasks: found.snapshot.tasks.map((t) =>
          t.assigneeId && !peopleIds.has(t.assigneeId) ? { ...t, assigneeId: null } : t,
        ),
        dependencies: found.snapshot.dependencies,
      };
      const event = commit(current, restored, `Откат: ${found.event.title}`, null, []);
      return { state: mustLoad(req.params.id), event };
    },
  );

  app.post('/api/demo/reset', async () => seedDemo());
}
