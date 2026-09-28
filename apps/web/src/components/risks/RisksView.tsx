import { memo, useMemo, useState } from 'react';
import { CalendarClock, Hourglass, Play, UserRoundX, type LucideIcon } from 'lucide-react';
import { indexToDate, safetyMargins, SPREAD, type Forecast, type Threat } from '@volna/engine';
import { chanceText, fmtChance, fmtDate, fmtDays } from '../../lib/format';
import { useModel, useProposeAction } from '../../lib/model';
import { toast, useDraft } from '../../store/draft';
import { Button, cx, Empty } from '../ui';

export function RisksView() {
  const { state } = useModel();
  if (state.tasks.length === 0) {
    return (
      <Empty title="Прогнозировать пока нечего">
        Добавьте задачи — вероятность успеть посчитается сама.
      </Empty>
    );
  }
  return (
    <div className="@container mx-auto max-w-[1080px] px-6 pt-6 pb-10">
      <ForecastSection />
      <div className="mt-8 grid gap-x-10 gap-y-8 border-t border-line pt-6 @3xl:grid-cols-[1.35fr_1fr]">
        <StormTest />
        <Margins />
      </div>
    </div>
  );
}

function ForecastSection() {
  const { forecast: f, baseForecast: bf, analysis, state, impact } = useModel();
  const changed = impact !== null && Math.round(f.chance * 100) !== Math.round(bf.chance * 100);
  const names = new Map(state.tasks.map((t) => [t.id, t.name]));
  const swing = f.drivers.filter((d) => d.share < 0.995 && d.share >= 0.02).slice(0, 3);
  const alwaysIds = new Set(f.drivers.filter((d) => d.share >= 0.995).map((d) => d.taskId));
  const always = analysis.order.filter((id) => alwaysIds.has(id)).map((id) => names.get(id));

  return (
    <section aria-labelledby="forecast-title">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <h2 id="forecast-title" className="text-[13px] font-semibold text-ink-2">
            Шанс успеть к дедлайну {fmtDate(state.project.deadline)}
          </h2>
          <p className="mt-1 flex items-baseline gap-3">
            <span
              className={cx(
                'font-display text-[56px] leading-none font-semibold',
                chanceText(f.chance),
              )}
            >
              {fmtChance(f.chance)}
            </span>
            {changed && (
              <span className="text-[14px] text-ink-3">
                было <span className="font-medium text-ink-2">{fmtChance(bf.chance)}</span>
              </span>
            )}
          </p>
        </div>
        <p className="max-w-[460px] pb-1 text-[14px] leading-relaxed text-ink-2">
          {f.planChance < 0.5 ? (
            <>
              Плановая дата {fmtDate(analysis.finishDate)} достигается лишь в{' '}
              {fmtChance(f.planChance)} сценариев: оценки задач обычно оптимистичны.{' '}
            </>
          ) : (
            <>
              Плановая дата {fmtDate(analysis.finishDate)} достигается в {fmtChance(f.planChance)}{' '}
              сценариев.{' '}
            </>
          )}
          Медианный прогноз — <span className="font-medium text-ink">{fmtDate(f.p50)}</span>, с
          уверенностью 80% проект закончится не позже{' '}
          <span className="font-medium text-ink">{fmtDate(f.p80)}</span>.
        </p>
      </div>

      <Histogram
        forecast={f}
        ghost={impact ? bf : null}
        planIndex={analysis.finishIndex}
        deadlineIndex={analysis.deadlineIndex}
      />

      {f.drivers.length > 0 && (
        <div className="mt-5 flex flex-wrap items-start gap-x-10 gap-y-3 text-[13px]">
          {swing.length > 0 && (
            <div className="min-w-[260px] flex-1">
              <p className="font-semibold text-ink-2">Что решает срок</p>
              <ul className="mt-2 space-y-1.5">
                {swing.map((d) => (
                  <li
                    key={d.taskId}
                    className="grid grid-cols-[minmax(0,1fr)_120px_40px] items-center gap-3"
                  >
                    <span className="truncate">{names.get(d.taskId)}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-sunken">
                      <span
                        className="block h-full rounded-full bg-ink"
                        style={{ width: `${d.share * 100}%` }}
                      />
                    </span>
                    <span className="text-right text-ink-2">{fmtChance(d.share)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[12px] text-ink-3">
                Доля сценариев, в которых задача определяет финиш
              </p>
            </div>
          )}
          {always.length > 0 && (
            <div className="min-w-[240px] flex-1">
              <p className="font-semibold text-ink-2">Критичны при любом раскладе</p>
              <p className="mt-2 leading-relaxed text-ink">{always.join(' → ')}</p>
            </div>
          )}
        </div>
      )}
      <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
        {f.runs.toLocaleString('ru-RU')} прогонов плана: длительность каждой незавершённой задачи от{' '}
        {pctShift(SPREAD.optimistic)} до {pctShift(SPREAD.pessimistic)} оценки, у подрядчиков и
        заблокированных задач — до {pctShift(SPREAD.riskyPessimistic)}.
      </p>
    </section>
  );
}

/** 0.9 → «−10%», 1.3 → «+30%». */
const pctShift = (factor: number) => {
  const p = Math.round((factor - 1) * 100);
  return `${p > 0 ? '+' : '−'}${Math.abs(p)}%`;
};

const HIST_HEIGHT = 132;
/** Насколько далеко от распределения ещё показываем дедлайн на оси, в рабочих днях. */
const DEADLINE_REACH = 10;

/** Распределение даты финиша: столбик — рабочий день, высота — доля сценариев. */
const Histogram = memo(function Histogram({
  forecast,
  ghost,
  planIndex,
  deadlineIndex,
}: {
  forecast: Forecast;
  ghost: Forecast | null;
  planIndex: number;
  deadlineIndex: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { bins, max, cumulative, deadlineInRange } = useMemo(() => {
    const counts = new Map(forecast.histogram.map((h) => [h.index, h.count]));
    const ghostCounts = new Map(ghost?.histogram.map((h) => [h.index, h.count]));
    const indices = [...counts.keys(), ...ghostCounts.keys(), planIndex];
    let lo = Math.min(...indices);
    let hi = Math.max(...indices);
    const inRange = deadlineIndex >= lo - DEADLINE_REACH && deadlineIndex <= hi + DEADLINE_REACH;
    if (inRange) {
      lo = Math.min(lo, deadlineIndex);
      hi = Math.max(hi, deadlineIndex + 1);
    }
    const list = [];
    let acc = 0;
    const cum = new Map<number, number>();
    for (let i = lo; i <= hi; i++) {
      acc += counts.get(i) ?? 0;
      cum.set(i, acc / forecast.runs);
      list.push({ index: i, count: counts.get(i) ?? 0, ghost: ghostCounts.get(i) ?? 0 });
    }
    const top = Math.max(1, ...list.map((b) => Math.max(b.count, b.ghost)));
    return { bins: list, max: top, cumulative: cum, deadlineInRange: inRange };
  }, [forecast, ghost, planIndex, deadlineIndex]);

  const dateOf = (index: number) => indexToDate(index - 1);
  const labelEvery = bins.length > 16 ? 3 : bins.length > 10 ? 2 : 1;
  const hovered = hover !== null ? bins.find((b) => b.index === hover) : undefined;

  return (
    <div className="mt-6">
      <p className="h-5 text-[13px] text-ink-2" aria-live="polite">
        {hovered ? (
          <>
            Закончим к{' '}
            <span className="font-medium text-ink">{fmtDate(dateOf(hovered.index))}</span> с
            вероятностью{' '}
            <span className="font-medium text-ink">
              {fmtChance(cumulative.get(hovered.index) ?? 0)}
            </span>
            {hovered.index > deadlineIndex && (
              <span className="text-crimson"> — позже дедлайна</span>
            )}
          </>
        ) : (
          'Наведите на столбик: с какой вероятностью проект закончится к этой дате'
        )}
      </p>
      <div
        className="relative mt-5 grid items-end gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${bins.length}, minmax(0, 1fr))`,
          height: HIST_HEIGHT,
        }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Распределение даты финиша: с вероятностью 80% не позже ${fmtDate(forecast.p80)}`}
      >
        {bins.map((b) => {
          const late = b.index > deadlineIndex;
          return (
            <div
              key={b.index}
              className="relative flex h-full items-end justify-center"
              onMouseEnter={() => setHover(b.index)}
            >
              <div className="relative flex h-full w-full max-w-[64px] items-end">
                {b.ghost > 0 && (
                  <span
                    className="absolute inset-x-0 bottom-0 rounded-t-md border border-b-0 border-ink-3/60"
                    style={{
                      height: `${(b.ghost / max) * 100}%`,
                      background:
                        'repeating-linear-gradient(-45deg, transparent 0 4px, color-mix(in srgb, var(--color-ink-3) 22%, transparent) 4px 5px)',
                    }}
                  />
                )}
                <span
                  className={cx(
                    'relative w-full rounded-t-md transition-[height,background-color,opacity] duration-500 ease-[var(--ease-out-soft)]',
                    late ? 'bg-crimson' : ghost ? 'bg-wave' : 'bg-ink/85',
                    // Накопленная вероятность: всё, что правее выбранной даты, приглушаем.
                    hover !== null && b.index > hover && 'opacity-30',
                  )}
                  style={{ height: b.count > 0 ? `max(3px, ${(b.count / max) * 100}%)` : 0 }}
                />
              </div>
              {deadlineInRange && b.index === deadlineIndex && (
                <span className="pointer-events-none absolute top-[-8px] -right-[5px] bottom-0 border-r-2 border-dashed border-crimson">
                  <span className="absolute top-[-12px] left-1.5 text-[12px] font-medium whitespace-nowrap text-crimson">
                    дедлайн
                  </span>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div
        className="mt-1.5 grid gap-1.5 border-t border-line pt-1.5 text-[12px] leading-4 text-ink-3"
        style={{ gridTemplateColumns: `repeat(${bins.length}, minmax(0, 1fr))` }}
        aria-hidden
      >
        {bins.map((b, i) => (
          <span
            key={b.index}
            className={cx(
              'text-center whitespace-nowrap',
              b.index === planIndex && 'font-medium text-cobalt',
            )}
          >
            {i % labelEvery === 0 || b.index === planIndex ? fmtDate(dateOf(b.index)) : ''}
            {b.index === planIndex && <span className="block">по плану</span>}
          </span>
        ))}
      </div>
      {!deadlineInRange && (
        <p className="mt-2 text-[12px] text-ink-3">
          Дедлайн {fmtDate(dateOf(deadlineIndex))}{' '}
          {deadlineIndex > bins[bins.length - 1].index
            ? 'далеко за пределами графика'
            : 'раньше всех сценариев'}
        </p>
      )}
    </div>
  );
});

const THREAT_ICON: Record<Threat['kind'], LucideIcon> = {
  harder: Hourglass,
  absence: UserRoundX,
  delay: CalendarClock,
};

function StormTest() {
  const { threats, analysis } = useModel();
  const proposeAction = useProposeAction();
  const alreadyLate = analysis.bufferDays < 0;

  const play = (t: Threat) => {
    if (proposeAction(t.ops, { action: t.reason, reason: t.reason })) {
      toast('Сценарий в черновике: волна — на таймлайне, прогноз — здесь', 'success');
    }
  };

  return (
    <section aria-labelledby="storm-title">
      <h2 id="storm-title" className="text-base font-semibold">
        Шторм-тест
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
        Что сорвёт срок, если случится. Каждый сбой уже просчитан по плану — проиграйте его, чтобы
        увидеть волну.
      </p>
      {threats.length === 0 ? (
        <p className="mt-4 rounded-lg border border-moss/25 bg-moss-soft px-4 py-3 text-[13px] text-moss">
          Типовые сбои не сдвигают финиш: у плана хороший запас прочности.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line-soft">
          {threats.map((t) => {
            const Icon = THREAT_ICON[t.kind];
            return (
              <li key={t.id} className="flex items-start gap-3 py-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sunken text-ink-2">
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] leading-snug font-medium">{t.title}</p>
                  <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{t.detail}</p>
                  <p
                    className={cx(
                      'mt-1 text-[12px] font-medium',
                      t.breaksDeadline || (alreadyLate && t.finishDelta > 0)
                        ? 'text-crimson'
                        : t.finishDelta > 0
                          ? 'text-ochre'
                          : 'text-ink-2',
                    )}
                  >
                    {t.finishDelta <= 0
                      ? `Финиш не сдвинется, но появятся новые угрозы: ${t.newProblems}`
                      : t.breaksDeadline
                        ? `Финиш ${fmtDays(t.finishDelta, true)}, дедлайн сорвётся на ${fmtDays(-t.bufferAfter)}`
                        : alreadyLate
                          ? `Финиш ${fmtDays(t.finishDelta, true)}, опоздание вырастет до ${fmtDays(-t.bufferAfter)}`
                          : `Финиш ${fmtDays(t.finishDelta, true)}, запас сократится до ${fmtDays(t.bufferAfter)}`}
                  </p>
                </div>
                <Button size="sm" className="mt-0.5 shrink-0" onClick={() => play(t)}>
                  <Play size={12} /> Проиграть
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Margins() {
  const { state, analysis } = useModel();
  const select = useDraft((s) => s.select);
  const margins = safetyMargins(state, analysis);
  const names = new Map(state.tasks.map((t) => [t.id, t.name]));
  const scale = Math.max(10, ...margins.map((m) => m.days));

  return (
    <section aria-labelledby="margin-title">
      <h2 id="margin-title" className="text-base font-semibold">
        Запас прочности
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
        На сколько рабочих дней задача может опоздать, прежде чем сорвётся дедлайн.
      </p>
      <ul className="mt-4 space-y-1">
        {margins.map((m) => {
          const tone = m.days <= 0 ? 'bg-crimson' : m.days <= 2 ? 'bg-ochre' : 'bg-ink-3/60';
          return (
            <li key={m.taskId}>
              <button
                type="button"
                onClick={() => select(m.taskId)}
                className="grid w-full grid-cols-[minmax(0,1fr)_96px_64px] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors duration-150 hover:bg-sunken active:bg-pressed"
              >
                <span className="truncate">{names.get(m.taskId)}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-sunken">
                  <span
                    className={cx('block h-full rounded-full', tone)}
                    style={{ width: `${Math.max(4, (Math.max(0, m.days) / scale) * 100)}%` }}
                  />
                </span>
                <span
                  className={cx(
                    'text-right',
                    m.days <= 0 ? 'font-medium text-crimson' : 'text-ink-2',
                  )}
                >
                  {m.days < 0 ? `опозд. ${-m.days}` : fmtDays(m.days)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
