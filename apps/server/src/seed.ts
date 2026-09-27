import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  analyze,
  indexToDate,
  startIndex,
  type Dependency,
  type Person,
  type ProjectState,
  type Task,
} from '@volna/engine';
import { db, todayISO, transaction } from './db';
import { deleteProject, insertPerson, insertProject, loadState, replaceTasksAndDeps } from './repo';

export const DEMO_PROJECT_ID = 'demo';

/** Запас до дедлайна в демо: проект в порядке, но изменение на +5 дней его сорвёт. */
const DEMO_BUFFER = 3;

/**
 * Демо-проект «Запуск мобильного приложения». Все даты считаются относительно сегодняшнего дня,
 * поэтому демо не устаревает: часть задач уже выполнена, часть в работе, часть впереди.
 */
export function buildDemoState(today: string): ProjectState {
  const T = startIndex(today);
  const S = T - 15;
  const d = (i: number) => indexToDate(i);
  const pid = DEMO_PROJECT_ID;

  const people: Person[] = [
    { id: randomUUID(), projectId: pid, name: 'Анна Смирнова', role: 'Руководитель проекта, аналитик', color: '#6366f1' },
    { id: randomUUID(), projectId: pid, name: 'Игорь Петров', role: 'UX/UI-дизайнер', color: '#ec4899' },
    { id: randomUUID(), projectId: pid, name: 'Дмитрий Козлов', role: 'Backend-разработчик', color: '#0ea5e9' },
    { id: randomUUID(), projectId: pid, name: 'Мария Волкова', role: 'Mobile-разработчик', color: '#f59e0b' },
    { id: randomUUID(), projectId: pid, name: 'Олег Новиков', role: 'QA-инженер', color: '#10b981' },
    { id: randomUUID(), projectId: pid, name: 'ПэйСофт', role: 'Подрядчик: платежи', color: '#8b5cf6' },
  ];
  const [anna, igor, dmitry, maria, oleg, paysoft] = people.map((p) => p.id);

  let order = 0;
  const mk = (
    name: string,
    durationDays: number,
    assigneeId: string,
    extra: Partial<Task> = {},
  ): Task => ({
    id: randomUUID(),
    projectId: pid,
    name,
    description: '',
    durationDays,
    status: 'not_started',
    assigneeId,
    dueDate: null,
    startNotEarlier: null,
    actualStart: null,
    actualEnd: null,
    sortOrder: order++,
    ...extra,
  });

  const analysis = mk('Анализ требований', 4, anna, {
    status: 'done', actualStart: d(S), actualEnd: d(S + 3),
    description: 'Интервью с заказчиком, user stories, критерии приёмки',
  });
  const prototype = mk('Прототип и UX-сценарии', 5, igor, {
    status: 'done', actualStart: d(S + 4), actualEnd: d(S + 8),
  });
  const architecture = mk('Архитектура и контракт API', 3, dmitry, {
    status: 'done', actualStart: d(S + 4), actualEnd: d(S + 6),
  });
  const uiDesign = mk('UI-дизайн экранов', 8, igor, {
    status: 'in_progress', actualStart: d(S + 9),
  });
  const backend = mk('Backend: API, база данных, авторизация', 19, dmitry, {
    status: 'in_progress', actualStart: d(S + 7),
    description: 'REST API, схема БД, JWT-авторизация, push-уведомления',
  });
  const payments = mk('Интеграция платежей', 5, paysoft, {
    startNotEarlier: d(T + 3),
    description: 'Выполняет подрядчик; раньше указанной даты команда подрядчика недоступна',
  });
  const mobile = mk('Мобильное приложение: экраны', 8, maria);
  const integration = mk('Интеграция приложения с API', 4, maria);
  const marketing = mk('Маркетинговые материалы для сторов', 4, igor);
  const testing = mk('Тестирование', 5, oleg);
  const bugfix = mk('Исправление багов', 3, dmitry);
  const publish = mk('Публикация в App Store и Google Play', 2, anna);
  const release = mk('Релиз v1.0', 0, anna);

  const tasks = [
    analysis, prototype, architecture, uiDesign, backend, payments, mobile,
    integration, marketing, testing, bugfix, publish, release,
  ];

  const link = (a: Task, b: Task, lagDays = 0): Dependency => ({
    id: randomUUID(), projectId: pid, predecessorId: a.id, successorId: b.id, lagDays,
  });
  const dependencies = [
    link(analysis, prototype),
    link(analysis, architecture),
    link(prototype, uiDesign),
    link(architecture, backend),
    link(architecture, payments, 1),
    link(uiDesign, mobile),
    link(uiDesign, marketing),
    link(backend, integration),
    link(mobile, integration),
    link(integration, testing),
    link(payments, testing),
    link(testing, bugfix),
    link(bugfix, publish),
    link(publish, release),
    link(marketing, release),
  ];

  const state: ProjectState = {
    project: {
      id: pid,
      name: 'Запуск мобильного приложения «ФитТрек»',
      description: 'MVP фитнес-приложения для клиента: iOS + Android, backend, оплата подписки',
      startDate: d(S),
      deadline: d(S),
      statusDate: null,
      createdAt: new Date().toISOString(),
    },
    people,
    tasks,
    dependencies,
  };

  // Дедлайн и сроки задач выставляем по расчёту, чтобы стартовая картина была «зелёной».
  const a = analyze(state, today);
  state.project.deadline = d(a.finishIndex - 1 + DEMO_BUFFER);
  for (const t of [mobile, integration, testing]) {
    t.dueDate = d(a.tasks[t.id].ef - 1 + 1);
  }
  return state;
}

export function seedDemo(): ProjectState {
  const state = buildDemoState(todayISO());
  transaction(() => {
    deleteProject(DEMO_PROJECT_ID);
    insertProject(state.project);
    state.people.forEach((p, i) => insertPerson(p, i));
    replaceTasksAndDeps(state);
  });
  return loadState(DEMO_PROJECT_ID)!;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = seedDemo();
  const a = analyze(s, todayISO());
  console.log(
    `Демо-проект создан: ${s.tasks.length} задач, финиш ${a.finishDate}, дедлайн ${s.project.deadline}, запас ${a.bufferDays} дн., статус ${a.health}`,
  );
  db.close();
}
