import { useMemo, type ReactNode } from 'react';
import { Trash2, X } from 'lucide-react';
import {
  analyze,
  applyChangeSet,
  describeOps,
  firstName,
  forecast,
  plural,
  FORECAST_RUNS,
  type ChangeOp,
  type Health,
  type ISODate,
  type ProjectState,
} from '@volna/engine';
import {
  chanceText,
  fmtBuffer,
  fmtChance,
  fmtDate,
  fmtDays,
  fmtTasks,
  HEALTH_COLOR,
  HEALTH_TEXT,
} from '../../lib/format';
import { useModel } from '../../lib/model';
import { confirmAction, sameOps, toast, useDraft } from '../../store/draft';
import { Button, cx, Dialog, IconButton } from '../ui';

const NO_OPS: ChangeOp[] = [];

interface Metrics {
  chance: number;
  finish: ISODate;
  finishIndex: number;
  finishDelta: number;
  deadline: ISODate;
  deadlineIndex: number;
  health: Health;
  buffer: number;
  threatened: number;
  overloaded: string[];
  lines: string[];
}

interface Column {
  id: string;
  label: string;
  name: string;
  ops: ChangeOp[];
  /** null — вариант не применяется к текущему плану (план изменился после сохранения). */
  metrics: Metrics | null;
}

function evaluate(
  base: ProjectState,
  baseFinish: number,
  ops: ChangeOp[],
  today: string,
): Metrics | null {
  try {
    const state = applyChangeSet(base, ops);
    const a = analyze(state, today);
    const overloaded = new Set(
      state.tasks
        .filter((t) => a.tasks[t.id].flags.overloaded && t.assigneeId)
        .map((t) => t.assigneeId!),
    );
    return {
      chance: forecast(state, today).chance,
      finish: a.finishDate,
      finishIndex: a.finishIndex,
      finishDelta: a.finishIndex - baseFinish,
      deadline: state.project.deadline,
      deadlineIndex: a.deadlineIndex,
      health: a.health,
      buffer: a.bufferDays,
      threatened: a.stats.threatened,
      overloaded: state.people.filter((p) => overloaded.has(p.id)).map((p) => firstName(p.name)),
      lines: describeOps(base, ops),
    };
  } catch {
    return null;
  }
}

export function CompareHost() {
  const open = useDraft((s) => s.compareOpen);
  return open ? <CompareDialog /> : null;
}

function CompareDialog() {
  const { base, baseAnalysis, ops, today } = useModel();
  const scenarios = useDraft((s) => s.scenarios);
  const setCompareOpen = useDraft((s) => s.setCompareOpen);
  const removeScenario = useDraft((s) => s.removeScenario);
  const renameScenario = useDraft((s) => s.renameScenario);
  const close = () => setCompareOpen(false);

  // Прогноз — самое дорогое; кэш по массиву операций переживает переименование вариантов.
  const cache = useMemo(
    () => new WeakMap<ChangeOp[], Metrics | null>(),
    [base, baseAnalysis, today],
  );
  const measure = (list: ChangeOp[]) => {
    if (!cache.has(list)) cache.set(list, evaluate(base, baseAnalysis.finishIndex, list, today));
    return cache.get(list)!;
  };

  const columns = useMemo(() => {
    const cols: Column[] = [
      {
        id: 'base',
        label: 'Как сейчас',
        name: 'Без изменений',
        ops: [],
        metrics: measure(NO_OPS),
      },
      ...scenarios.map((s) => ({
        id: s.id,
        label: `Вариант ${s.letter}`,
        name: s.name,
        ops: s.ops,
        metrics: measure(s.ops),
      })),
    ];
    if (ops.length > 0 && !scenarios.some((s) => sameOps(s.ops, ops))) {
      cols.push({
        id: 'draft',
        label: 'Черновик',
        name: 'Ещё не сохранён',
        ops,
        metrics: measure(ops),
      });
    }
    return cols;
  }, [cache, scenarios, ops]);

  // Рекомендуем вариант с наибольшим шансом успеть; при равенстве — более ранний финиш и меньше правок.
  const recommended = useMemo(() => {
    const options = columns.filter((c) => c.id !== 'base' && c.metrics);
    options.sort(
      (a, b) =>
        b.metrics!.chance - a.metrics!.chance ||
        a.metrics!.finishDelta - b.metrics!.finishDelta ||
        a.metrics!.lines.length - b.metrics!.lines.length,
    );
    // С одним вариантом рекомендовать нечего — выбор только между ним и «как сейчас».
    return options.length > 1 ? options[0].id : null;
  }, [columns]);

  const open = (c: Column) => {
    // Вариант уже проверен движком при расчёте колонки; причина изменения остаётся прежней.
    useDraft.setState({
      ops: c.ops,
      lastAction: c.id === 'draft' ? useDraft.getState().lastAction : c.name,
    });
    toast(`${c.label} открыт в черновике`, 'success');
    close();
  };

  // «Как сейчас» — точка отсчёта, а не вариант: лучшее ищем среди вариантов.
  const valid = columns.filter((c) => c.metrics && c.id !== 'base');
  const best = (pick: (m: Metrics) => number, dir: 'max' | 'min') => {
    const values = valid.map((c) => pick(c.metrics!));
    return dir === 'max' ? Math.max(...values) : Math.min(...values);
  };
  const bestFinish = best((m) => m.finishDelta, 'min');
  const bestBuffer = best((m) => m.buffer, 'max');
  const bestThreatened = best((m) => m.threatened, 'min');

  const cell = (c: Column, render: (m: Metrics) => ReactNode) =>
    c.metrics ? render(c.metrics) : <span className="text-ink-3">—</span>;

  // Общая шкала для полосок «финиш относительно дедлайна» — по всем колонкам.
  const scale = useMemo(() => {
    const marks = columns.flatMap((c) =>
      c.metrics ? [c.metrics.finishIndex, c.metrics.deadlineIndex] : [],
    );
    const lo = Math.min(...marks) - 1;
    const hi = Math.max(...marks) + 1;
    return { lo, span: Math.max(1, hi - lo) };
  }, [columns]);
  const at = (index: number) => `${((index - scale.lo) / scale.span) * 100}%`;

  const remove = async (c: Column) => {
    const ok = await confirmAction({
      title: `Удалить ${c.label.replace(/^Вариант/, 'вариант')}?`,
      text: `«${c.name}» пропадёт из сравнения. Сам план это не изменит.`,
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (ok) removeScenario(c.id);
  };

  const rows: { label: string; render: (c: Column) => ReactNode }[] = [
    {
      label: 'Шанс успеть',
      render: (c) =>
        cell(c, (m) => (
          <span
            className={cx(
              'font-display text-[26px] leading-none font-semibold',
              chanceText(m.chance),
            )}
          >
            {fmtChance(m.chance)}
          </span>
        )),
    },
    {
      label: 'Финиш и дедлайн',
      render: (c) =>
        cell(c, (m) => {
          const late = m.finishIndex > m.deadlineIndex;
          return (
            <span
              className="relative block h-5"
              title={`Финиш ${fmtDate(m.finish)}, дедлайн ${fmtDate(m.deadline)}`}
            >
              <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-sunken" />
              <span
                className={cx(
                  'absolute top-1/2 h-1 -translate-y-1/2 rounded-full',
                  late ? 'bg-crimson' : 'bg-moss',
                )}
                style={{
                  left: at(Math.min(m.finishIndex, m.deadlineIndex)),
                  right: `calc(100% - ${at(Math.max(m.finishIndex, m.deadlineIndex))})`,
                }}
              />
              <span
                className="absolute top-0 bottom-0 border-l-2 border-dashed border-crimson"
                style={{ left: at(m.deadlineIndex) }}
              />
              <span
                className={cx(
                  'absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface',
                  late ? 'bg-crimson' : 'bg-ink',
                )}
                style={{ left: at(m.finishIndex) }}
              />
            </span>
          );
        }),
    },
    {
      label: 'Прогноз финиша',
      render: (c) =>
        cell(c, (m) => (
          <Best on={m.finishDelta === bestFinish && valid.length > 1}>
            {fmtDate(m.finish)}
            {m.finishDelta !== 0 && (
              <span
                className={cx('ml-1 text-[12px]', m.finishDelta > 0 ? 'text-crimson' : 'text-moss')}
              >
                {fmtDays(m.finishDelta, true)}
              </span>
            )}
          </Best>
        )),
    },
    {
      label: 'Дедлайн',
      render: (c) =>
        cell(c, (m) => (
          <span
            className={cx(m.deadline !== base.project.deadline && 'font-medium text-wave-deep')}
          >
            {fmtDate(m.deadline)}
          </span>
        )),
    },
    {
      label: 'До дедлайна',
      render: (c) =>
        cell(c, (m) => (
          <Best on={m.buffer === bestBuffer && valid.length > 1}>
            <span className={cx(m.buffer < 0 && 'text-crimson')}>{fmtBuffer(m.buffer)}</span>
          </Best>
        )),
    },
    {
      label: 'Вердикт',
      render: (c) =>
        cell(c, (m) => (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: HEALTH_COLOR[m.health] }}
            />
            {HEALTH_TEXT[m.health]}
          </span>
        )),
    },
    {
      label: 'Под угрозой',
      render: (c) =>
        cell(c, (m) => (
          <Best on={m.threatened === bestThreatened && valid.length > 1}>
            {m.threatened === 0 ? 'нет' : fmtTasks(m.threatened)}
          </Best>
        )),
    },
    {
      label: 'Перегружены',
      render: (c) => cell(c, (m) => (m.overloaded.length ? m.overloaded.join(', ') : 'никто')),
    },
    {
      label: 'Что меняем',
      render: (c) =>
        c.metrics ? (
          c.metrics.lines.length === 0 ? (
            <span className="text-ink-3">ничего</span>
          ) : (
            <ul className="space-y-1 text-[12px] leading-snug text-ink-2">
              <li className="font-medium text-ink">
                {c.metrics.lines.length}{' '}
                {plural(c.metrics.lines.length, 'изменение', 'изменения', 'изменений')}
              </li>
              {c.metrics.lines.slice(0, 3).map((l, i) => (
                <li key={i}>{l}</li>
              ))}
              {c.metrics.lines.length > 3 && (
                <li className="text-ink-3">и ещё {c.metrics.lines.length - 3}</li>
              )}
            </ul>
          )
        ) : (
          <span className="text-[12px] text-ink-3">
            План изменился после сохранения — вариант больше не применить
          </span>
        ),
    },
  ];

  const highlight = (c: Column) => c.id === recommended && 'bg-moss-soft/60';

  return (
    <Dialog onClose={close} labelledBy="compare-title" width="max-w-[1040px]">
      <div className="flex items-start gap-3 px-6 pt-6">
        <div className="flex-1">
          <h2 id="compare-title" className="text-lg font-semibold">
            Сравнение вариантов
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">
            Все варианты посчитаны от текущего плана тем же движком. Откройте лучший — он станет
            черновиком.
          </p>
        </div>
        <IconButton label="Закрыть" onClick={close}>
          <X size={16} />
        </IconButton>
      </div>

      {columns.length < 2 ? (
        <p className="m-6 rounded-lg border border-line bg-paper px-4 py-3 text-[13px] text-ink-2">
          Пока сравнивать не с чем. Соберите черновик и нажмите «В варианты» — или сохраните план
          советника.
        </p>
      ) : (
        <div className="overflow-x-auto px-6 pt-7 pb-6">
          <table className="w-full min-w-[640px] table-fixed border-separate border-spacing-0 text-[13px]">
            <colgroup>
              <col className="w-[140px]" />
              {columns.map((c) => (
                <col key={c.id} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th />
                {columns.map((c) => (
                  <th
                    key={c.id}
                    className={cx(
                      'relative rounded-t-2xl px-3 pt-3 pb-3 text-left align-bottom font-normal',
                      highlight(c),
                    )}
                  >
                    {c.id === recommended && (
                      <span className="absolute -top-3 left-3 rounded-md bg-moss px-1.5 py-0.5 text-[12px] font-semibold text-white">
                        Лучший из вариантов
                      </span>
                    )}
                    <span className="block text-[13px] font-semibold text-ink">{c.label}</span>
                    {c.id === 'base' || c.id === 'draft' ? (
                      <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">
                        {c.name}
                      </span>
                    ) : (
                      <input
                        className="-mx-1.5 mt-0.5 w-[calc(100%+0.75rem)] truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[12px] text-ink-2 transition-colors outline-none hover:border-line focus:border-cobalt focus:bg-surface"
                        value={c.name}
                        onChange={(e) => renameScenario(c.id, e.target.value)}
                        aria-label={`Название: ${c.label}`}
                        title="Нажмите, чтобы переименовать"
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th className="border-t border-line-soft py-2.5 pr-3 text-left align-top text-[12px] font-medium text-ink-3">
                    {r.label}
                  </th>
                  {columns.map((c) => (
                    <td
                      key={c.id}
                      className={cx(
                        'border-t border-line-soft px-3 py-2.5 align-top',
                        highlight(c),
                      )}
                    >
                      {r.render(c)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td />
                {columns.map((c) => (
                  <td key={c.id} className={cx('rounded-b-2xl px-3 pt-2 pb-3', highlight(c))}>
                    {c.id !== 'base' && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant={c.id === recommended ? 'primary' : 'secondary'}
                          className="flex-1"
                          disabled={!c.metrics}
                          onClick={() => open(c)}
                        >
                          Открыть
                        </Button>
                        {c.id !== 'draft' && (
                          <IconButton
                            label={`Удалить: ${c.label}`}
                            className="h-7 w-7"
                            onClick={() => remove(c)}
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        )}
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-[12px] text-ink-3">
            Шанс успеть — доля из {FORECAST_RUNS.toLocaleString('ru-RU')} прогонов плана, в которых
            проект укладывается в дедлайн варианта.
          </p>
        </div>
      )}
    </Dialog>
  );
}

function Best({ on, children }: { on: boolean; children: ReactNode }) {
  return <span className={cx(on && 'font-semibold text-moss')}>{children}</span>;
}
