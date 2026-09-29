// Сквозная проверка сценариев ТЗ через API. Требует запущенный сервер (npm run dev или npm start).
// Создаёт и удаляет временный проект, в конце пересоздаёт демо-проект. Адрес: E2E_URL (по умолчанию :3001).
import {
  analyze,
  addWorkdays,
  diffAnalyses,
  advise,
  type ChangeOp,
  type ProjectState,
  type Task,
} from '@volna/engine';

const B = process.env.E2E_URL ?? 'http://127.0.0.1:3001/api';
let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`);
  if (!cond) fails++;
};
async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const r = await fetch(B + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, data: (text ? JSON.parse(text) : null) as T };
}
const today = (() => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

// 1. Создание проекта: название и сроки
const start = addWorkdays(today, -10);
const created = await call<ProjectState>('POST', '/projects', {
  name: 'E2E проверка',
  description: 'Тест',
  startDate: start,
  deadline: addWorkdays(today, 25),
});
ok(created.status === 201, 'проект создаётся (201)');
const pid = created.data.project.id;
ok(created.data.project.startDate === start, 'сроки проекта сохранены');

const bad = await call<{ error: { message: string } }>('POST', '/projects', {
  name: 'x', startDate: '2026-10-10', deadline: '2026-10-01',
});
ok(bad.status === 400, `дедлайн раньше старта отклоняется: ${bad.data.error.message}`);
const noName = await call('POST', '/projects', { name: '  ', startDate: start, deadline: start });
ok(noName.status === 400, 'пустое название отклоняется');

// Люди
const ids: string[] = [];
for (const name of ['Анна', 'Борис', 'Вера']) {
  const r = await call<{ id: string }>('POST', `/projects/${pid}/people`, { name, role: 'роль' });
  ok(r.status === 201, `добавлен человек ${name}`);
  ids.push(r.data.id);
}
const [anna, boris, vera] = ids;

// 2–3. Задачи: срок, ответственный, статус; зависимости
const mk = (id: string, name: string, dur: number, extra: Partial<Task> = {}): Task => ({
  id, projectId: pid, name, description: '', durationDays: dur, status: 'not_started',
  assigneeId: null, dueDate: null, startNotEarlier: null, actualStart: null, actualEnd: null,
  sortOrder: Number(id.slice(1)), ...extra,
});
const tasks: Task[] = [
  mk('t1', 'Анализ требований', 3, { status: 'done', assigneeId: anna, actualStart: start, actualEnd: addWorkdays(start, 2) }),
  mk('t2', 'Дизайн', 4, { status: 'done', assigneeId: boris, actualStart: addWorkdays(start, 3), actualEnd: addWorkdays(start, 6) }),
  mk('t3', 'Разработка', 8, { status: 'in_progress', assigneeId: vera, actualStart: addWorkdays(start, 7) }),
  mk('t4', 'Тестирование', 4, { assigneeId: anna, dueDate: addWorkdays(today, 12) }),
  mk('t5', 'Документация', 3, { assigneeId: boris }),
  mk('t6', 'Обучение', 2, { assigneeId: boris }),
  mk('t7', 'Приёмка', 2, { assigneeId: anna }),
  mk('t8', 'Запуск', 0, { assigneeId: anna }),
];
const dep = (a: string, b: string, lag = 0) => ({ id: `${a}>${b}`, projectId: pid, predecessorId: a, successorId: b, lagDays: lag });
const deps = [dep('t1', 't2'), dep('t2', 't3'), dep('t3', 't4'), dep('t2', 't5'), dep('t5', 't6'), dep('t4', 't7'), dep('t6', 't7'), dep('t7', 't8')];
const ops: ChangeOp[] = [
  ...tasks.map((task) => ({ type: 'createTask' as const, task })),
  ...deps.map((dependency) => ({ type: 'addDependency' as const, dependency })),
];
const r1 = await call<{ state: ProjectState }>('POST', `/projects/${pid}/changes`, { ops, reason: 'Первичный план' });
ok(r1.status === 200 && r1.data.state.tasks.length === 8, 'план из 8 задач и 8 связей сохранён одним изменением');
let state = r1.data.state;
let a = analyze(state, today);
ok(a.criticalPath.includes('t3') && a.criticalPath.includes('t4'), `критический путь: ${a.criticalPath.join(' → ')}`);
ok(a.tasks.t1.flags.critical === false, 'выполненная задача не критическая');
ok(a.tasks.t5.float > 0, `у ветки документации есть резерв (${a.tasks.t5.float} дн.)`);
ok(a.stats.done === 2 && a.stats.inProgress === 1, 'есть выполненные и незавершённые задачи');

// Цикл отклоняется
const cyc = await call<{ error: { code: string; message: string } }>('POST', `/projects/${pid}/changes`, {
  ops: [{ type: 'addDependency', dependency: dep('t8', 't3') }],
});
ok(cyc.status === 400 && cyc.data.error.code === 'cycle', `цикл отклонён: ${cyc.data.error.message}`);
const dup = await call<{ error: { code: string } }>('POST', `/projects/${pid}/changes`, { ops: [{ type: 'addDependency', dependency: { ...dep('t1', 't2'), id: 'other' } }] });
ok(dup.status === 400 && dup.data.error.code === 'duplicate', 'дубликат связи отклонён');
const self = await call('POST', `/projects/${pid}/changes`, { ops: [{ type: 'addDependency', dependency: dep('t4', 't4') }] });
ok(self.status === 400, 'связь с самой собой отклонена');
const neg = await call('POST', `/projects/${pid}/changes`, { ops: [{ type: 'updateTask', taskId: 't4', patch: { durationDays: -1 } }] });
ok(neg.status === 400, 'отрицательная длительность отклонена');
const ghost = await call('POST', `/projects/${pid}/changes`, { ops: [{ type: 'updateTask', taskId: 'nope', patch: { durationDays: 1 } }] });
ok(ghost.status === 404, 'несуществующая задача → 404');
const badAssignee = await call('POST', `/projects/${pid}/changes`, { ops: [{ type: 'updateTask', taskId: 't4', patch: { assigneeId: 'nobody' } }] });
ok(badAssignee.status === 404, 'несуществующий ответственный → 404');

// 4. Анализ последствий: «Разработка» +6 дней
const change: ChangeOp[] = [{ type: 'updateTask', taskId: 't3', patch: { durationDays: 14 } }];
const beforeA = analyze(state, today);
const r2 = await call<{ state: ProjectState; event: { finishBefore: string; finishAfter: string; bufferAfter: number } }>(
  'POST', `/projects/${pid}/changes`, { ops: change, reason: 'Сложнее, чем думали' },
);
const afterA = analyze(r2.data.state, today);
const impact = diffAnalyses(state, beforeA, r2.data.state, afterA, change);
ok(impact.affected.map((x) => x.taskId).join(',') === 't3,t4,t7,t8', `затронуты последующие задачи: ${impact.affected.map((x) => x.name).join(', ')}`);
ok(!impact.affected.some((x) => ['t1', 't2', 't5', 't6'].includes(x.taskId)), 'параллельная ветка и выполненные задачи не сдвинуты');
ok(impact.finishDelta === 6, `срок проекта изменился на +${impact.finishDelta}`);
ok(afterA.tasks.t4.flags.missesDueDate, 'Тестирование под угрозой (не успевает к сроку)');
ok(impact.verdict === 'intervention' || impact.verdict === 'attention', `вердикт: ${impact.verdict} — ${impact.headline}`);
ok(impact.affected.find((x) => x.taskId === 't8')!.chain.join('>') === 't3>t4>t7>t8', 'цепочка причин до вехи');
ok(r2.data.event.finishAfter === afterA.finishDate, 'сервер посчитал тот же финиш, что и клиент');
state = r2.data.state;

// Смена статуса / ответственного / зависимости / удаление
const r3 = await call<{ state: ProjectState }>('POST', `/projects/${pid}/changes`, {
  ops: [
    { type: 'updateTask', taskId: 't5', patch: { status: 'blocked' } },
    { type: 'updateTask', taskId: 't6', patch: { assigneeId: vera } },
    { type: 'removeDependency', dependencyId: 't5>t6' },
    { type: 'addDependency', dependency: dep('t2', 't6', 2) },
    { type: 'updateDependency', dependencyId: 't4>t7', lagDays: -1 },
    { type: 'deleteTask', taskId: 't5' },
  ],
});
ok(r3.status === 200, 'статус, ответственный, связи и удаление применены атомарно');
state = r3.data.state;
ok(!state.tasks.some((t) => t.id === 't5') && !state.dependencies.some((d) => d.predecessorId === 't5'), 'удалённая задача ушла вместе со связями');
ok(state.tasks.find((t) => t.id === 't6')!.assigneeId === vera, 'ответственный сменён');
a = analyze(state, today);
ok(a.tasks.t6.flags.overloaded && a.tasks.t3.flags.overloaded, 'Вера перегружена: «Разработка» и «Обучение» пересекаются');

// Советник
const adv = advise(state, today);
ok(adv.suggestions.some((s) => s.kind === 'reassign'), 'советник предлагает переназначение при перегрузе');
if (a.bufferDays < 0) ok(adv.plan?.fitsDeadline, 'план восстановления укладывается в дедлайн');

// Журнал и откат
const log = await call<{ id: string; title: string }[]>('GET', `/projects/${pid}/changes`);
ok(log.data.length === 3, `в журнале 3 записи: ${log.data.map((e) => e.title.slice(0, 40)).join(' | ')}`);
const rev = await call<{ state: ProjectState }>('POST', `/projects/${pid}/changes/${log.data[1].id}/revert`);
ok(rev.data.state.tasks.find((t) => t.id === 't3')!.durationDays === 8, 'откат вернул план до «+6 дней»');
ok(rev.data.state.tasks.some((t) => t.id === 't5'), 'откат вернул удалённую задачу');
const log2 = await call<unknown[]>('GET', `/projects/${pid}/changes`);
ok(log2.data.length === 4, 'откат сам записан в журнал');

// Удаление человека снимает назначения
const del = await call('DELETE', `/projects/${pid}/people/${anna}`);
const after = await call<ProjectState>('GET', `/projects/${pid}`);
ok(del.status === 204 && !after.data.tasks.some((t) => t.assigneeId === anna), 'удаление человека снимает его назначения');

// Правка проекта
const patch = await call<ProjectState>('PATCH', `/projects/${pid}`, { name: 'E2E переименован' });
ok(patch.data.project.name === 'E2E переименован', 'проект переименован');

await call('DELETE', `/projects/${pid}`);
const gone = await call('GET', `/projects/${pid}`);
ok(gone.status === 404, 'проект удалён');

// Демо-данные соответствуют требованиям ТЗ
const demo = await call<ProjectState>('POST', '/demo/reset');
const d = demo.data;
const da = analyze(d, today);
const delDemo = await call('DELETE', '/projects/demo');
ok(delDemo.status === 403, 'общий демо-проект нельзя удалить');
ok(d.tasks.length >= 8, `демо: ${d.tasks.length} задач (≥ 8)`);
ok(d.dependencies.length >= 3, `демо: ${d.dependencies.length} зависимостей`);
ok(new Set(d.tasks.map((t) => t.assigneeId)).size >= 3, 'демо: несколько ответственных');
ok(da.stats.done > 0 && da.stats.done < d.tasks.length, 'демо: есть выполненные и незавершённые');
ok(da.health === 'ok' && da.bufferDays === 3, `демо стартует «зелёным», запас ${da.bufferDays}`);
const backend = d.tasks.find((t) => t.name.startsWith('Backend'))!;
const demoOps: ChangeOp[] = [{ type: 'updateTask', taskId: backend.id, patch: { durationDays: backend.durationDays + 5 } }];
const { applyChangeSet } = await import('@volna/engine');
const dAfter = applyChangeSet(d, demoOps);
const dImpact = diffAnalyses(d, da, dAfter, analyze(dAfter, today), demoOps);
ok(dImpact.wavedCount >= 3 && dImpact.bufferAfter < 0, `демо: +5 к Backend сдвигает ${dImpact.wavedCount} задач и срывает дедлайн (${dImpact.bufferAfter})`);

console.log(fails === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `\nПРОВАЛЕНО: ${fails}`);
