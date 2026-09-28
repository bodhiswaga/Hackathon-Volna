import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CircleHelp, Flame, Maximize2, Minus, Plus, Users } from 'lucide-react';
import {
  addCalendarDays,
  diffCalendarDays,
  indexToDate,
  isWeekend,
  parseDate,
  type ISODate,
  type TaskImpact,
} from '@volna/engine';
import { useModel } from '../../lib/model';
import { fmtDate, fmtDays, fmtMonth, STATUS_LABEL } from '../../lib/format';
import { useDraft } from '../../store/draft';
import { Avatar, Chip, cx, Empty, IconButton, Popover, StatusDot } from '../ui';

const ROW = 44;
const HEADER = 52;
const LEFT = 260;
const MIN_DAY_W = 8;
const BAR_H = 20;
const CARD_W = 264;

const FILL = {
  done: 'var(--color-moss)',
  in_progress: 'var(--color-cobalt)',
  blocked: 'var(--color-ochre)',
  not_started: 'var(--color-bar-idle)',
} as const;

const EDGE = {
  plain: { color: '#b3bccb', marker: 'arrow-plain' },
  critical: { color: 'var(--color-crimson)', marker: 'arrow-critical' },
  wave: { color: 'var(--color-wave)', marker: 'arrow-wave' },
} as const;

const WEEKEND = 'rgb(18 29 51 / 0.028)';

const isMonday = (d: ISODate) => new Date(parseDate(d)).getUTCDay() === 1;
const minDate = (xs: ISODate[]) => xs.reduce((m, x) => (x < m ? x : m));
const maxDate = (xs: ISODate[]) => xs.reduce((m, x) => (x > m ? x : m));

export function GanttView() {
  const { state, analysis: a, baseAnalysis: b, impact } = useModel();
  const selectedId = useDraft((s) => s.selectedTaskId);
  const select = useDraft((s) => s.select);
  // null — масштаб подбирается автоматически; число — пользователь зумил вручную.
  const [zoom, setZoom] = useState<number | null>(null);
  const [viewport, setViewport] = useState(0);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(state.tasks.map((t) => [t.id, t])), [state.tasks]);
  const peopleById = useMemo(() => new Map(state.people.map((p) => [p.id, p])), [state.people]);
  const affected = useMemo(
    () => new Map<string, TaskImpact>((impact?.affected ?? []).map((x) => [x.taskId, x])),
    [impact],
  );
  const critDeps = useMemo(() => new Set(a.criticalDependencyIds), [a.criticalDependencyIds]);

  const order = a.order;
  const range = useMemo(() => {
    const starts = [state.project.startDate, a.today, ...order.map((id) => a.tasks[id].startDate)];
    const ends = [a.finishDate, state.project.deadline, a.today, ...order.map((id) => indexToDate(a.tasks[id].lf - 1))];
    if (impact) {
      starts.push(...Object.values(b.tasks).map((t) => t.startDate));
      ends.push(b.finishDate);
    }
    for (const t of state.tasks) if (t.dueDate) ends.push(t.dueDate);
    const start = addCalendarDays(minDate(starts), -2);
    const end = addCalendarDays(maxDate(ends), 7);
    return { start, days: diffCalendarDays(start, end) + 1 };
  }, [state, a, b, impact, order]);

  const autoW = viewport > 0 ? Math.floor((viewport - LEFT - 16) / range.days) : 26;
  const dayW = zoom ?? Math.min(40, Math.max(MIN_DAY_W, autoW));
  const x = (d: ISODate) => diffCalendarDays(range.start, d) * dayW;
  const width = range.days * dayW;
  const height = order.length * ROW;
  const rowOf = new Map(order.map((id, i) => [id, i]));

  // Следим за шириной области: по умолчанию весь план вписан в экран (волна видна целиком),
  // в том числе когда черновик расширяет диапазон дат.
  const hasTasks = order.length > 0;
  useLayoutEffect(() => {
    const scroller = rootRef.current?.parentElement;
    if (!scroller) return;
    const update = () => setViewport(scroller.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [hasTasks]);

  if (order.length === 0) {
    return (
      <Empty title="В проекте пока нет задач">
        Нажмите «Задача» вверху справа, чтобы добавить первую. Даты посчитаются сами из длительности и связей.
      </Empty>
    );
  }

  const days = Array.from({ length: range.days }, (_, i) => addCalendarDays(range.start, i));
  const barGeom = (id: string, source: 'after' | 'before' = 'after') => {
    const s = (source === 'after' ? a : b).tasks[id];
    const row = rowOf.get(id)!;
    const y = row * ROW + (ROW - BAR_H) / 2;
    const milestone = s.ef === s.es;
    const x1 = x(s.startDate);
    const x2 = x(s.endDate) + dayW;
    return { s, y, x1: milestone ? x2 : x1, x2, milestone };
  };

  const deadlineX = x(state.project.deadline) + dayW;
  const todayX = x(a.today);

  const hovered = hoverId && rowOf.has(hoverId) ? hoverId : null;

  return (
    <div ref={rootRef} className="relative bg-surface" style={{ width: LEFT + width, minHeight: '100%' }}>
      {/* Шапка: полупрозрачная, строки видны при прокрутке под ней */}
      <div className="sticky top-0 z-20 flex">
        <div
          className="sticky left-0 z-30 flex items-end justify-between border-r border-b border-line bg-surface pr-2 pb-1.5 pl-4"
          style={{ width: LEFT, height: HEADER }}
        >
          <span className="pb-1 text-[12px] font-medium text-ink-3">Задачи по порядку</span>
          <div className="flex items-center">
            <Popover
              label="Обозначения"
              align="start"
              buttonClassName="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink aria-expanded:bg-ink/5 aria-expanded:text-ink"
              button={<CircleHelp size={15} />}
              panelClassName="w-72 p-3"
            >
              {() => <Legend />}
            </Popover>
            {zoom !== null && (
              <IconButton label="Вписать весь план в экран" className="h-7 w-7" onClick={() => setZoom(null)}>
                <Maximize2 size={14} />
              </IconButton>
            )}
            <IconButton label="Уменьшить масштаб" className="h-7 w-7" onClick={() => setZoom(Math.max(MIN_DAY_W, dayW - 4))}>
              <Minus size={14} />
            </IconButton>
            <IconButton label="Увеличить масштаб" className="h-7 w-7" onClick={() => setZoom(Math.min(56, dayW + 6))}>
              <Plus size={14} />
            </IconButton>
          </div>
        </div>
        <div className="glass border-b border-line">
          <svg width={width} height={HEADER} className="block">
            {days.map((d, i) => {
              const first = i === 0 || d.endsWith('-01');
              return (
                <g key={d}>
                  {isWeekend(d) && <rect x={i * dayW} y={22} width={dayW} height={HEADER - 22} fill={WEEKEND} />}
                  {first && (
                    <text
                      x={i * dayW + 6}
                      y={15}
                      fontSize={12}
                      fontWeight={600}
                      className="font-display"
                      fill="var(--color-ink-2)"
                    >
                      {fmtMonth(d)}
                    </text>
                  )}
                  {first && i > 0 && <line x1={i * dayW} x2={i * dayW} y1={0} y2={HEADER} stroke="var(--color-line)" />}
                  {(dayW >= 18 || isMonday(d)) && (
                    <text
                      x={i * dayW + dayW / 2}
                      y={42}
                      textAnchor="middle"
                      fontSize={11}
                      fill={isWeekend(d) ? 'var(--color-ink-3)' : 'var(--color-ink-2)'}
                    >
                      {Number(d.slice(8))}
                    </text>
                  )}
                </g>
              );
            })}
            <rect x={todayX} y={27} width={dayW} height={21} rx={6} fill="var(--color-cobalt)" opacity={0.12} />
            <rect
              x={todayX}
              y={27}
              width={dayW}
              height={21}
              rx={6}
              fill="none"
              stroke="var(--color-cobalt)"
              strokeWidth={1.5}
            />
            {/* Подложка, чтобы подпись дедлайна не сливалась с названием месяца. */}
            <rect x={deadlineX - 96} y={3} width={94} height={17} rx={8.5} fill="var(--color-crimson-soft)" />
            <text x={deadlineX - 8} y={15.5} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--color-crimson)">
              дедлайн {fmtDate(state.project.deadline)}
            </text>
          </svg>
        </div>
      </div>

      <div className="flex">
        {/* Список задач */}
        <div className="sticky left-0 z-10 border-r border-line bg-surface" style={{ width: LEFT }}>
          {order.map((id) => {
            const t = byId.get(id)!;
            const s = a.tasks[id];
            const imp = affected.get(id);
            return (
              <button
                type="button"
                key={id}
                onClick={() => select(id)}
                onMouseEnter={() => setHoverId(id)}
                onMouseLeave={() => setHoverId(null)}
                className={cx(
                  'flex w-full items-center gap-2 border-b border-line-soft px-4 text-left text-[13px] transition-colors',
                  selectedId === id ? 'bg-cobalt-soft' : imp ? 'bg-wave-soft' : 'hover:bg-paper',
                )}
                style={{ height: ROW }}
              >
                <StatusDot status={t.status} />
                <span
                  className={cx('min-w-0 flex-1 truncate', t.status === 'done' ? 'text-ink-3' : 'text-ink')}
                  title={`${t.name}: ${STATUS_LABEL[t.status]}`}
                >
                  {t.name}
                </span>
                {s.flags.critical && <Flame size={14} className="shrink-0 text-crimson" aria-label="На критическом пути" />}
                {s.risk === 'high' && <AlertTriangle size={14} className="shrink-0 text-crimson" aria-label="Под угрозой" />}
                {s.flags.overloaded && <Users size={14} className="shrink-0 text-wave" aria-label="Исполнитель перегружен" />}
                <Avatar person={t.assigneeId ? peopleById.get(t.assigneeId) : null} size={20} />
              </button>
            );
          })}
        </div>

        {/* Поле диаграммы */}
        <svg width={width} height={height} className="block">
          <defs>
            {Object.values(EDGE).map((e) => (
              <marker key={e.marker} id={e.marker} viewBox="0 0 8 8" refX={7} refY={4} markerWidth={7} markerHeight={7} orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill={e.color} />
              </marker>
            ))}
            <pattern id="ghost-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-idle)" strokeWidth="1.5" />
            </pattern>
          </defs>

          {days.map((d, i) => (isWeekend(d) ? <rect key={d} x={i * dayW} y={0} width={dayW} height={height} fill={WEEKEND} /> : null))}
          {order.map((id, i) => (
            <g key={id}>
              {(selectedId === id || hovered === id) && (
                <rect
                  x={0}
                  y={i * ROW}
                  width={width}
                  height={ROW}
                  fill={selectedId === id ? 'var(--color-cobalt-soft)' : 'var(--color-paper)'}
                  opacity={selectedId === id ? 0.6 : 0.7}
                />
              )}
              <line x1={0} x2={width} y1={(i + 1) * ROW} y2={(i + 1) * ROW} stroke="var(--color-line-soft)" />
            </g>
          ))}

          <rect x={todayX} y={0} width={dayW} height={height} fill="var(--color-cobalt)" opacity={0.05} />
          <line x1={todayX} x2={todayX} y1={0} y2={height} stroke="var(--color-cobalt)" strokeWidth={1.5} />
          <line x1={deadlineX} x2={deadlineX} y1={0} y2={height} stroke="var(--color-crimson)" strokeWidth={2} strokeDasharray="6 4" />

          {/* Связи */}
          {state.dependencies.map((d) => {
            if (!rowOf.has(d.predecessorId) || !rowOf.has(d.successorId)) return null;
            const p = barGeom(d.predecessorId);
            const s = barGeom(d.successorId);
            const x1 = p.milestone ? p.x2 + 7 : p.x2;
            const y1 = p.y + BAR_H / 2;
            const x2 = s.milestone ? s.x1 - 8 : s.x1;
            const y2 = s.y + BAR_H / 2;
            const drv = a.tasks[d.successorId].driver;
            const wave = affected.has(d.successorId) && drv.kind === 'dependency' && drv.dependencyId === d.id;
            const edge = wave ? EDGE.wave : critDeps.has(d.id) ? EDGE.critical : EDGE.plain;
            const rowBoundary = Math.max(p.y, s.y) - (ROW - BAR_H) / 2;
            const path =
              x2 - x1 >= 14
                ? `M${x1},${y1} H${x1 + 7} V${y2} H${x2 - 1}`
                : `M${x1},${y1} H${x1 + 7} V${rowBoundary} H${x2 - 9} V${y2} H${x2 - 1}`;
            return (
              <path
                key={d.id}
                d={path}
                fill="none"
                stroke={edge.color}
                strokeWidth={edge === EDGE.plain ? 1.3 : 1.8}
                strokeLinejoin="round"
                markerEnd={`url(#${edge.marker})`}
              />
            );
          })}

          {/* Призраки прежних дат */}
          {impact &&
            order.map((id) => {
              const imp = affected.get(id);
              if (!imp || imp.created || (imp.deltaStart === 0 && imp.deltaEnd === 0) || !b.tasks[id]) return null;
              const g = barGeom(id, 'before');
              if (g.milestone) {
                const cy = g.y + BAR_H / 2;
                return <path key={id} d={`M${g.x2},${cy - 8} l8,8 l-8,8 l-8,-8 z`} fill="none" stroke="var(--color-idle)" strokeDasharray="3 2" />;
              }
              return (
                <rect
                  key={id}
                  x={g.x1}
                  y={g.y}
                  width={Math.max(4, g.x2 - g.x1)}
                  height={BAR_H}
                  rx={6}
                  fill="url(#ghost-hatch)"
                  stroke="var(--color-idle)"
                  strokeDasharray="4 3"
                  opacity={0.9}
                />
              );
            })}

          {/* Полосы задач */}
          {order.map((id) => {
            const t = byId.get(id)!;
            const g = barGeom(id);
            const s = g.s;
            const imp = affected.get(id);
            const shifted = imp && (imp.deltaEnd !== 0 || imp.deltaStart !== 0 || imp.created);
            const delay = imp ? (imp.chain.length - 1) * 110 : 0;
            const crit = s.flags.critical;
            const fill = shifted ? 'var(--color-wave)' : FILL[t.status];
            const stroke =
              selectedId === id
                ? 'var(--color-ink)'
                : crit
                  ? 'var(--color-crimson)'
                  : shifted
                    ? 'var(--color-wave-deep)'
                    : t.status === 'not_started'
                      ? 'var(--color-idle)'
                      : fill;
            const w = Math.max(4, g.x2 - g.x1);
            const cy = g.y + BAR_H / 2;
            const floatEndX = x(indexToDate(s.lf - 1)) + dayW;

            return (
              <g
                key={`${id}-${imp ? imp.deltaEnd : 0}`}
                className={shifted ? 'wave-in' : undefined}
                style={{ animationDelay: `${delay}ms`, cursor: 'pointer' }}
                onClick={() => select(id)}
                onMouseEnter={() => setHoverId(id)}
                onMouseLeave={() => setHoverId(null)}
              >
                {/* Невидимая зона наведения на всю строку, чтобы карточка не мерцала между полосой и резервом */}
                <rect x={Math.min(g.x1, g.x2) - 10} y={g.y - 8} width={w + 20} height={BAR_H + 16} fill="transparent" />
                {t.status !== 'done' && s.float > 0 && !g.milestone && (
                  <g stroke="var(--color-idle)" strokeWidth={1.2}>
                    <line x1={g.x2} x2={floatEndX} y1={cy} y2={cy} strokeDasharray="2 3" />
                    <line x1={floatEndX} x2={floatEndX} y1={cy - 4} y2={cy + 4} />
                  </g>
                )}
                {g.milestone ? (
                  <path
                    d={`M${g.x2},${cy - 9} l9,9 l-9,9 l-9,-9 z`}
                    fill={shifted ? 'var(--color-wave)' : crit ? 'var(--color-crimson)' : 'var(--color-ink)'}
                    stroke={selectedId === id ? 'var(--color-ink)' : 'none'}
                    strokeWidth={2}
                  />
                ) : (
                  <>
                    <rect x={g.x1} y={g.y} width={w} height={BAR_H} rx={6} fill={fill} stroke={stroke} strokeWidth={crit || selectedId === id ? 2 : 1} />
                    {t.status === 'in_progress' && !shifted && todayX > g.x1 && (
                      <rect x={g.x1} y={g.y} width={Math.min(w, todayX - g.x1)} height={BAR_H} rx={6} fill="#1c34a8" opacity={0.5} />
                    )}
                    {w >= 44 && (
                      <text
                        x={g.x1 + 8}
                        y={cy + 4}
                        fontSize={11}
                        fontWeight={600}
                        fill={t.status === 'not_started' && !shifted ? 'var(--color-ink-2)' : '#fff'}
                      >
                        {t.durationDays} дн.
                      </text>
                    )}
                  </>
                )}
                {t.dueDate && (
                  <g>
                    <line
                      x1={x(t.dueDate) + dayW}
                      x2={x(t.dueDate) + dayW}
                      y1={g.y - 5}
                      y2={g.y + BAR_H + 5}
                      stroke={s.flags.missesDueDate ? 'var(--color-crimson)' : 'var(--color-ink-2)'}
                      strokeWidth={1.5}
                    />
                    <path
                      d={`M${x(t.dueDate) + dayW},${g.y - 5} l7,3 l-7,3 z`}
                      fill={s.flags.missesDueDate ? 'var(--color-crimson)' : 'var(--color-ink-2)'}
                    />
                  </g>
                )}
                {imp && imp.deltaEnd !== 0 && (
                  <g transform={`translate(${Math.max(g.x2, t.dueDate ? x(t.dueDate) + dayW : 0) + (g.milestone ? 14 : 8)}, ${g.y + 1})`}>
                    <rect width={imp.deltaEnd > 0 ? 50 : 46} height={18} rx={9} fill={imp.deltaEnd > 0 ? 'var(--color-wave)' : 'var(--color-moss)'} />
                    <text x={imp.deltaEnd > 0 ? 25 : 23} y={13} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">
                      {fmtDays(imp.deltaEnd, true)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {hovered && (
        <HoverCard
          id={hovered}
          geom={barGeom(hovered)}
          rootWidth={LEFT + width}
          bodyHeight={height}
        />
      )}
    </div>
  );
}

/** Карточка задачи при наведении: даты, резерв, сдвиг — без клика и без перехода в редактор. */
function HoverCard({
  id,
  geom,
  rootWidth,
  bodyHeight,
}: {
  id: string;
  geom: { y: number; x1: number; x2: number };
  rootWidth: number;
  bodyHeight: number;
}) {
  const { state, analysis: a, impact } = useModel();
  const t = state.tasks.find((x) => x.id === id);
  const s = a.tasks[id];
  if (!t || !s) return null;
  const person = state.people.find((p) => p.id === t.assigneeId);
  const imp = impact?.affected.find((x) => x.taskId === id);
  const below = geom.y + BAR_H + 150 < bodyHeight;
  const left = Math.max(LEFT + 8, Math.min(LEFT + geom.x1, rootWidth - CARD_W - 12));
  const top = HEADER + (below ? geom.y + BAR_H + 10 : geom.y - 10);

  return (
    // Внешний слой позиционирует (над или под полосой), внутренний — анимирует появление.
    <div
      className="pointer-events-none absolute z-40"
      style={{ left, top, width: CARD_W, transform: below ? undefined : 'translateY(-100%)' }}
    >
      <div role="tooltip" className="glass-strong animate-pop-in rounded-2xl border border-line/70 p-3.5 shadow-float">
        <div className="flex items-start gap-2">
          <StatusDot status={t.status} />
          <p className="-mt-1 min-w-0 flex-1 text-[13px] leading-snug font-semibold">{t.name}</p>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-2">
          <Avatar person={person} size={18} />
          <span className="truncate">{person?.name ?? 'Не назначен'}</span>
          <span className="ml-auto shrink-0 text-ink-3">{STATUS_LABEL[t.status]}</span>
        </div>
        <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line/70 pt-2.5 text-[12px]">
          <dt className="text-ink-3">Сроки</dt>
          <dd className="text-right font-medium">
            {fmtDate(s.startDate)} — {fmtDate(s.endDate)}
          </dd>
          <dt className="text-ink-3">Длительность</dt>
          <dd className="text-right font-medium">{t.durationDays > 0 ? fmtDays(t.durationDays) : 'веха'}</dd>
          {t.status !== 'done' && (
            <>
              <dt className="text-ink-3">Резерв</dt>
              <dd className={cx('text-right font-medium', s.flags.critical && 'text-crimson')}>
                {s.flags.critical ? 'нет' : fmtDays(s.float)}
              </dd>
            </>
          )}
          {t.dueDate && (
            <>
              <dt className="text-ink-3">Срок задачи</dt>
              <dd className={cx('text-right font-medium', s.flags.missesDueDate && 'text-crimson')}>{fmtDate(t.dueDate)}</dd>
            </>
          )}
        </dl>
        {imp && imp.deltaEnd !== 0 && (
          <div className="mt-2.5">
            <Chip tone={imp.deltaEnd > 0 ? 'wave' : 'moss'}>
              окончание {fmtDays(imp.deltaEnd, true)}: {fmtDate(imp.endBefore)} → {fmtDate(imp.endAfter)}
            </Chip>
          </div>
        )}
      </div>
    </div>
  );
}

function Legend() {
  const item = (swatch: ReactNode, label: string) => (
    <li className="flex items-center gap-2.5">
      <span className="flex w-6 justify-center">{swatch}</span>
      {label}
    </li>
  );
  const box = (bg: string, border?: string) => (
    <span className="inline-block h-3 w-6 rounded-[5px]" style={{ background: bg, border: border ? `2px solid ${border}` : undefined }} />
  );
  return (
    <>
      <p className="mb-2 font-display text-[14px] font-semibold">Обозначения</p>
      <ul className="grid grid-cols-1 gap-1.5 text-[12px] text-ink-2">
        {item(box(FILL.done), 'Выполнена')}
        {item(box(FILL.in_progress), 'В работе')}
        {item(box(FILL.not_started, 'var(--color-idle)'), 'Не начата')}
        {item(box(FILL.blocked), 'Заблокирована')}
        {item(box(FILL.not_started, 'var(--color-crimson)'), 'На критическом пути')}
        {item(box('var(--color-wave)'), 'Сдвинута изменением из черновика')}
        {item(box('transparent', 'var(--color-idle)'), 'Прежние даты (призрак)')}
        {item(<span className="inline-block w-6 border-t-2 border-dotted border-idle" />, 'Резерв: насколько можно сдвинуть')}
        {item(<span className="inline-block h-3.5 w-0.5 bg-ink-2" />, 'Срок задачи')}
        {item(<span className="inline-block h-3.5 w-0.5 bg-cobalt" />, 'Сегодня')}
        {item(<span className="inline-block h-3.5 border-l-2 border-dashed border-crimson" />, 'Дедлайн проекта')}
      </ul>
    </>
  );
}
