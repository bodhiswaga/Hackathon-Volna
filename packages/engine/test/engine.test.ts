import { describe, expect, it } from 'vitest';
import {
  addWorkdays,
  advise,
  analyze,
  applyChangeSet,
  ChangeSetError,
  diffAnalyses,
  endIndex,
  indexToDate,
  startIndex,
  type ChangeOp,
} from '../src';
import { dep, person, START, state, task } from './fixtures';

const TODAY = START;

/** Цепочка из ТЗ: Анализ → Дизайн → Разработка → Тестирование. */
function chain() {
  return state(
    [task('A', 3), task('B', 2), task('C', 5), task('D', 2)],
    [dep('A', 'B'), dep('B', 'C'), dep('C', 'D')],
  );
}

describe('календарь', () => {
  it('пропускает выходные', () => {
    expect(startIndex('2026-09-12')).toBe(startIndex('2026-09-14')); // сб → пн
    expect(endIndex('2026-09-13')).toBe(endIndex('2026-09-11')); // вс → пт
    expect(addWorkdays('2026-09-11', 1)).toBe('2026-09-14');
    expect(indexToDate(startIndex('2026-09-16'))).toBe('2026-09-16');
  });
});

describe('расписание (CPM)', () => {
  it('считает даты цепочки из ТЗ с учётом выходных', () => {
    const a = analyze(chain(), TODAY);
    expect(a.tasks.A.startDate).toBe('2026-09-07');
    expect(a.tasks.A.endDate).toBe('2026-09-09');
    expect(a.tasks.B.startDate).toBe('2026-09-10');
    expect(a.tasks.B.endDate).toBe('2026-09-11');
    expect(a.tasks.C.startDate).toBe('2026-09-14');
    expect(a.tasks.D.endDate).toBe('2026-09-22');
    expect(a.finishDate).toBe('2026-09-22');
    expect(a.criticalPath).toEqual(['A', 'B', 'C', 'D']);
  });

  it('находит резерв и критический путь в параллельных ветках', () => {
    const s = state(
      [task('A', 2), task('B', 5), task('C', 2), task('D', 1)],
      [dep('A', 'B'), dep('A', 'C'), dep('B', 'D'), dep('C', 'D')],
    );
    const a = analyze(s, TODAY);
    expect(a.tasks.C.float).toBe(3);
    expect(a.tasks.B.float).toBe(0);
    expect(a.criticalPath).toEqual(['A', 'B', 'D']);
    expect(a.criticalDependencyIds.sort()).toEqual(['A>B', 'B>D']);
    expect(a.tasks.C.flags.critical).toBe(false);
  });

  it('не двигает выполненные задачи и использует их фактические даты', () => {
    const s = state(
      [
        task('A', 3, { status: 'done', actualStart: '2026-09-07', actualEnd: '2026-09-08' }),
        task('B', 2),
      ],
      [dep('A', 'B')],
    );
    const a = analyze(s, TODAY);
    expect(a.tasks.A.endDate).toBe('2026-09-08');
    expect(a.tasks.B.startDate).toBe('2026-09-09');
    expect(a.tasks.A.flags.critical).toBe(false);
  });

  it('учитывает лаг и ограничение «не раньше»', () => {
    const lag = analyze(state([task('A', 2), task('B', 1)], [dep('A', 'B', 2)]), TODAY);
    expect(lag.tasks.B.startDate).toBe('2026-09-11');

    const cons = analyze(
      state([task('A', 2), task('B', 1, { startNotEarlier: '2026-09-16' })], [dep('A', 'B')]),
      TODAY,
    );
    expect(cons.tasks.B.startDate).toBe('2026-09-16');
    expect(cons.tasks.B.driver.kind).toBe('constraint');
  });

  it('не планирует незавершённое в прошлом и отмечает просрочку', () => {
    const s = state(
      [
        task('A', 3, { status: 'in_progress', actualStart: '2026-09-07' }),
        task('B', 2),
      ],
      [dep('A', 'B')],
    );
    const a = analyze(s, '2026-09-16');
    expect(a.tasks.A.endDate).toBe('2026-09-16');
    expect(a.tasks.A.flags.overdue).toBe(true);
    expect(a.tasks.B.startDate).toBe('2026-09-17');
    expect(a.health).toBe('intervention');
  });

  it('фиксирует нарушение дедлайна и срока задачи', () => {
    const s = chain();
    s.project.deadline = '2026-09-18';
    s.tasks[2].dueDate = '2026-09-17';
    const a = analyze(s, TODAY);
    expect(a.bufferDays).toBe(-2);
    expect(a.tasks.C.flags.missesDueDate).toBe(true);
    expect(a.alerts[0].code).toBe('deadline_missed');
  });
});

describe('ChangeSet', () => {
  it('отклоняет цикл', () => {
    const op: ChangeOp = { type: 'addDependency', dependency: dep('D', 'A') };
    try {
      applyChangeSet(chain(), [op]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ChangeSetError);
      expect((e as ChangeSetError).code).toBe('cycle');
      expect((e as ChangeSetError).details).toEqual({ taskIds: ['A', 'B', 'C', 'D', 'A'] });
    }
  });

  it('не мутирует исходное состояние', () => {
    const s = chain();
    applyChangeSet(s, [{ type: 'updateTask', taskId: 'B', patch: { durationDays: 9 } }]);
    expect(s.tasks[1].durationDays).toBe(2);
  });

  it('удаляет связи вместе с задачей', () => {
    const next = applyChangeSet(chain(), [{ type: 'deleteTask', taskId: 'B' }]);
    expect(next.dependencies.map((d) => d.id)).toEqual(['C>D']);
  });
});

describe('анализ последствий', () => {
  it('сдвигает только транзитивных последователей и объясняет цепочку', () => {
    const s = state(
      [task('A', 3), task('B', 2), task('C', 5), task('D', 2), task('E', 3)],
      [dep('A', 'B'), dep('B', 'C'), dep('C', 'D')],
    );
    const ops: ChangeOp[] = [{ type: 'updateTask', taskId: 'B', patch: { durationDays: 4 } }];
    const after = applyChangeSet(s, ops);
    const r = diffAnalyses(s, analyze(s, TODAY), after, analyze(after, TODAY), ops);

    expect(r.affected.map((x) => x.taskId)).toEqual(['B', 'C', 'D']);
    const d = r.affected.find((x) => x.taskId === 'D')!;
    expect(d.deltaEnd).toBe(2);
    expect(d.chain).toEqual(['B', 'C', 'D']);
    expect(r.finishDelta).toBe(2);
    expect(r.wavedCount).toBe(2);
    expect(r.verdict).toBe('attention');
  });

  it('требует вмешательства при выходе за дедлайн', () => {
    const s = chain();
    s.project.deadline = '2026-09-23';
    const ops: ChangeOp[] = [{ type: 'updateTask', taskId: 'C', patch: { durationDays: 8 } }];
    const after = applyChangeSet(s, ops);
    const r = diffAnalyses(s, analyze(s, TODAY), after, analyze(after, TODAY), ops);
    expect(r.bufferBefore).toBe(1);
    expect(r.bufferAfter).toBe(-2);
    expect(r.verdict).toBe('intervention');
    expect(r.newAlerts.some((a) => a.code === 'deadline_missed')).toBe(true);
  });
});

describe('советник', () => {
  it('предлагает ускорение и план, который укладывается в дедлайн', () => {
    const s = state(
      [task('A', 5), task('B', 10), task('C', 5), task('X', 3)],
      [dep('A', 'B'), dep('B', 'C'), dep('A', 'X'), dep('X', 'C')],
    );
    const base = analyze(s, TODAY);
    s.project.deadline = indexToDate(base.finishIndex - 1 - 3);
    const advice = advise(s, TODAY);

    expect(analyze(s, TODAY).bufferDays).toBe(-3);
    const crashB = advice.suggestions.find((x) => x.id === 'crash:B')!;
    expect(crashB.gainDays).toBe(3);
    expect(advice.plan?.fitsDeadline).toBe(true);
    const planned = applyChangeSet(s, advice.plan!.ops);
    expect(analyze(planned, TODAY).bufferDays).toBe(advice.plan!.bufferAfter);
    expect(advice.suggestions.at(-1)?.kind).toBe('moveDeadline');

    // Нахлёст ограничен половиной предшественника (A = 5 дн. → максимум 2 дня).
    const par = advice.suggestions.find((x) => x.id === 'par:A>B')!;
    expect(par.gainDays).toBe(2);
    expect(par.ops[0]).toMatchObject({ type: 'updateDependency', lagDays: -2 });
  });

  it('берёт минимальное ускорение, которого хватает до дедлайна', () => {
    const s = state([task('A', 5), task('B', 10), task('C', 5)], [dep('A', 'B'), dep('B', 'C')]);
    s.project.deadline = indexToDate(analyze(s, TODAY).finishIndex - 1 - 1);
    const crash = advise(s, TODAY).suggestions.find((x) => x.id === 'crash:B')!;
    expect(crash.gainDays).toBe(1);
    expect(crash.ops[0]).toMatchObject({ patch: { durationDays: 9 } });
  });

  it('не даёт нахлёсту превысить длительность предшественника', () => {
    expect(() =>
      applyChangeSet(chain(), [{ type: 'updateDependency', dependencyId: 'A>B', lagDays: -4 }]),
    ).toThrow(ChangeSetError);
    const ok = applyChangeSet(chain(), [{ type: 'updateDependency', dependencyId: 'A>B', lagDays: -1 }]);
    expect(analyze(ok, TODAY).tasks.B.startDate).toBe('2026-09-09');
  });

  it('видит перегруз и предлагает свободного исполнителя', () => {
    const s = state(
      [task('A', 3, { assigneeId: 'ivan' }), task('B', 3, { assigneeId: 'ivan' })],
      [],
      { people: [person('ivan'), person('olga')] },
    );
    const a = analyze(s, TODAY);
    expect(a.tasks.A.flags.overloaded).toBe(true);
    expect(a.alerts.some((x) => x.code === 'overloaded')).toBe(true);
    const r = advise(s, TODAY).suggestions.find((x) => x.kind === 'reassign');
    expect(r?.ops[0]).toMatchObject({ patch: { assigneeId: 'olga' } });
    expect(r?.resolves.length).toBeGreaterThan(0);
  });
});
