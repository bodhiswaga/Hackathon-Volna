import { describe, expect, it } from 'vitest';
import {
  analyze,
  applyChangeSet,
  buildBrief,
  compileEvent,
  diffAnalyses,
  forecast,
  safetyMargins,
  stressTest,
  type ChangeOp,
  type ProjectState,
} from '../src';
import { dep, person, START, state, task } from './fixtures';

const TODAY = START;
const FLAT = { optimistic: 1, pessimistic: 1, riskyPessimistic: 1 };

/** Цепочка A(3) → B(2) → C(5) → D(2): финиш 22 сен (вт). */
function chain(deadline = '2026-12-31'): ProjectState {
  return state(
    [
      task('A', 3, { assigneeId: 'p' }),
      task('B', 2, { assigneeId: 'p' }),
      task('C', 5, { assigneeId: 'q' }),
      task('D', 2, { assigneeId: 'q' }),
    ],
    [dep('A', 'B'), dep('B', 'C'), dep('C', 'D')],
    { deadline, people: [person('p'), person('q')] },
  );
}

const withOps = (s: ProjectState, ops: ChangeOp[]) => applyChangeSet(s, ops);

describe('прогноз «Шанс успеть»', () => {
  it('без разброса совпадает с детерминированным расчётом', () => {
    expect(forecast(chain('2026-09-22'), TODAY, { spread: FLAT }).chance).toBe(1);
    expect(forecast(chain('2026-09-21'), TODAY, { spread: FLAT }).chance).toBe(0);
    const f = forecast(chain(), TODAY, { spread: FLAT });
    expect(f.p50).toBe('2026-09-22');
    expect(f.planChance).toBe(1);
    expect(f.drivers.map((d) => d.share)).toEqual([1, 1, 1, 1]);
  });

  it('детерминирован и падает, когда критическая задача затягивается', () => {
    const s = chain('2026-09-24');
    const before = forecast(s, TODAY);
    expect(forecast(s, TODAY)).toEqual(before);
    expect(before.chance).toBeGreaterThan(0);
    expect(before.chance).toBeLessThan(1);
    const after = forecast(
      withOps(s, [{ type: 'updateTask', taskId: 'C', patch: { durationDays: 7 } }]),
      TODAY,
    );
    expect(after.chance).toBeLessThan(before.chance);
  });

  it('не варьирует выполненные задачи', () => {
    const s = state(
      [task('A', 3, { status: 'done', actualStart: START, actualEnd: '2026-09-09' })],
      [],
      { deadline: '2026-09-09' },
    );
    const f = forecast(s, '2026-09-14');
    expect(f.histogram).toHaveLength(1);
    expect(f.chance).toBe(1);
  });
});

describe('события «Что случилось?»', () => {
  it('ставит на паузу начатую задачу и сдвигает старт той, что начнётся в отпуск', () => {
    const s = state(
      [
        task('A', 5, { assigneeId: 'p', status: 'in_progress', actualStart: START }),
        task('B', 3, { assigneeId: 'q' }),
        task('C', 2, { assigneeId: 'p' }),
      ],
      [dep('B', 'C')],
      { people: [person('p'), person('q')] },
    );
    // Отпуск чт–пт: A (пн–пт) встаёт на 2 дня, C (старт в чт) ждёт понедельника.
    const { ops } = compileEvent(
      s,
      TODAY,
      { kind: 'absence', personId: 'p', from: '2026-09-10', to: '2026-09-11', handoverTo: null },
      () => 'x',
    );
    expect(ops).toEqual([
      { type: 'updateTask', taskId: 'A', patch: { durationDays: 7 } },
      { type: 'updateTask', taskId: 'C', patch: { startNotEarlier: '2026-09-14' } },
    ]);
  });

  it('ставит на паузу задачу в работе, даже если отпуск начинается в день её старта или она просрочена', () => {
    // A начата в понедельник и должна была кончиться во вторник; сегодня среда — она просрочена.
    const s = state(
      [task('A', 2, { assigneeId: 'p', status: 'in_progress', actualStart: START })],
      [],
      { people: [person('p')] },
    );
    const today = '2026-09-09';
    const before = analyze(s, today).tasks.A.ef;
    const fromStart = compileEvent(
      s,
      START,
      { kind: 'absence', personId: 'p', from: START, to: '2026-09-08', handoverTo: null },
      () => 'x',
    );
    expect(fromStart.ops).toEqual([
      { type: 'updateTask', taskId: 'A', patch: { durationDays: 4 } },
    ]);
    const { ops } = compileEvent(
      s,
      today,
      { kind: 'harder', taskId: 'A', extraDays: 2 },
      () => 'x',
    );
    expect(analyze(applyChangeSet(s, ops), today).tasks.A.ef).toBe(before + 2);
  });

  it('передаёт задачи другому сотруднику, не трогая даты', () => {
    const { ops, title } = compileEvent(
      chain(),
      TODAY,
      { kind: 'absence', personId: 'p', from: START, to: '2026-09-08', handoverTo: 'q' },
      () => 'x',
    );
    expect(ops).toEqual([{ type: 'updateTask', taskId: 'A', patch: { assigneeId: 'q' } }]);
    expect(title).toContain('q');
  });

  it('добавляет новое требование в цепочку и проверяет событие движком', () => {
    let n = 0;
    const { ops } = compileEvent(
      chain(),
      TODAY,
      {
        kind: 'scope',
        name: 'Экспорт в PDF',
        durationDays: 2,
        afterTaskId: 'B',
        beforeTaskId: 'D',
        assigneeId: 'q',
      },
      () => `n${n++}`,
    );
    const a = analyze(withOps(chain(), ops), TODAY);
    expect(a.tasks.n0.es).toBe(a.tasks.B.ef);
    expect(() =>
      compileEvent(chain(), TODAY, { kind: 'harder', taskId: 'A', extraDays: 0 }, () => 'x'),
    ).toThrow();
  });
});

describe('шторм-тест', () => {
  it('ранжирует угрозы по ущербу и считает запас прочности', () => {
    // A(5) → C(1) критична, B(1) → C с резервом 4 дня; дедлайн впритык.
    const s = state([task('A', 5), task('B', 1), task('C', 1)], [dep('A', 'C'), dep('B', 'C')], {
      deadline: '2026-09-14',
    });
    const a = analyze(s, TODAY);
    const threats = stressTest(s, a, TODAY);
    expect(threats[0]).toMatchObject({ taskId: 'A', breaksDeadline: true, finishDelta: 2 });
    expect(threats.some((t) => t.taskId === 'B')).toBe(false);
    expect(safetyMargins(s, a)).toEqual([
      { taskId: 'A', days: 0 },
      { taskId: 'C', days: 0 },
      { taskId: 'B', days: 4 },
    ]);
  });
});

describe('брифинг «Сообщить»', () => {
  it('просит решение у заказчика и пишет каждому затронутому', () => {
    const before = chain('2026-09-22');
    const ops: ChangeOp[] = [{ type: 'updateTask', taskId: 'A', patch: { durationDays: 6 } }];
    const after = withOps(before, ops);
    const impact = diffAnalyses(before, analyze(before, TODAY), after, analyze(after, TODAY), ops);
    const brief = buildBrief({ before, after, impact, ops, reason: 'Анализ сложнее' });
    expect(brief.client).toContain('Нужно решение');
    expect(brief.client).toContain('Анализ сложнее');
    expect(brief.team.map((m) => m.personId)).toEqual(['p', 'q']);
    expect(brief.team[0].text).toContain('«B»');
    expect(brief.team[1].text).toContain('«D»');
    // Коротко для мессенджера: без приветствия, с причиной и просьбой о решении, не длиннее 4 строк.
    expect(brief.short.split('\n').length).toBeLessThanOrEqual(4);
    expect(brief.short).not.toContain('Здравствуйте');
    expect(brief.short).toContain('Причина: Анализ сложнее.');
    expect(brief.short).toContain('Нужно решение');
    // Выбранное в советнике решение попадает в письмо вместе с шансом.
    const withSolution = buildBrief({
      before,
      after,
      impact,
      ops,
      reason: null,
      solution: 'Ольга берёт часть «B»',
      chance: { before: 0.9, after: 0.7 },
    });
    expect(withSolution.client).toContain(
      'Предлагаемое решение: Ольга берёт часть «B» — вероятность успеть с ним 70%.',
    );
    expect(withSolution.short).toContain('Решение: Ольга берёт часть «B».');
    expect(withSolution.short.split('\n').length).toBeLessThanOrEqual(4);

    // Тот же сдвиг, но с переносом дедлайна: у заказчика просим подтвердить новый срок.
    const moved: ChangeOp[] = [
      ...ops,
      { type: 'updateProject', patch: { deadline: '2026-10-02' } },
    ];
    const afterMoved = withOps(before, moved);
    const impactMoved = diffAnalyses(
      before,
      analyze(before, TODAY),
      afterMoved,
      analyze(afterMoved, TODAY),
      moved,
    );
    const briefMoved = buildBrief({
      before,
      after: afterMoved,
      impact: impactMoved,
      ops: moved,
      reason: null,
    });
    expect(briefMoved.client).toContain('Нужно подтвердить новый срок сдачи: 22 сен → 2 окт');
    expect(briefMoved.short).toContain('Прошу подтвердить новый срок: 2 окт.');
  });
});
