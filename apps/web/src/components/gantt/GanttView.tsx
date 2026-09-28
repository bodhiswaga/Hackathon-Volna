import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CircleHelp, Flame, Maximize2, Minus, Plus, Users } from 'lucide-react';
import {
  addCalendarDays,
  diffCalendarDays,
  indexToDate,
  isWeekend,
  parseDate,
  safetyMargin,
  type Dependency,
  type ISODate,
  type Person,
  type Task,
  type TaskImpact,
  type TaskSchedule,
} from '@volna/engine';
import { useAddTask, useModel, usePropose, useRecalcFlash } from '../../lib/model';
import { fmtDate, fmtDays, fmtMonth, STATUS_LABEL } from '../../lib/format';
import { GLOSSARY } from '../../lib/glossary';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useDraft } from '../../store/draft';
import { Avatar, Button, Chip, cx, Empty, IconButton, Popover, StatusDot, Tooltip } from '../ui';

const ROW = 40;
const HEADER = 56;
const MIN_DAY_W = 8;
const BAR_H = 18;
const CARD_W = 264;

// Полосы: выполненные уходят на второй план, в работе — акцент, сдвинутые черновиком — оранжевые.
const FILL = {
  done: '#cfe6d9',
  in_progress: 'var(--color-cobalt)',
  blocked: 'var(--color-ochre-bar)',
  not_started: 'var(--color-bar-idle)',
} as const;
const LABEL = {
  done: 'var(--color-moss)',
  in_progress: '#fff',
  blocked: 'var(--color-ink)',
  not_started: 'var(--color-ink-2)',
} as const;

const EDGE = {
  plain: { color: 'var(--color-idle)', marker: 'arrow-plain' },
  critical: { color: 'var(--color-crimson)', marker: 'arrow-critical' },
  wave: { color: 'var(--color-wave)', marker: 'arrow-wave' },
  linked: { color: 'var(--color-ink)', marker: 'arrow-linked' },
} as const;

const WEEKEND = 'rgb(21 24 30 / 0.025)';

const isMonday = (d: ISODate) => new Date(parseDate(d)).getUTCDay() === 1;
const minDate = (xs: ISODate[]) => xs.reduce((m, x) => (x < m ? x : m));
const maxDate = (xs: ISODate[]) => xs.reduce((m, x) => (x > m ? x : m));

export function GanttView() {
  const { state, analysis: a, baseAnalysis: b, impact } = useModel();
  const selectedId = useDraft((s) => s.selectedTaskId);
  const select = useDraft((s) => s.select);
  const flash = useRecalcFlash(a);
  const roomy = useMediaQuery('(min-width: 640px)');
  const LEFT = roomy ? 280 : 172;
  // null — масштаб подбирается автоматически; число — пользователь зумил вручную.
  const [zoom, setZoom] = useState<number | null>(null);
  const [viewport, setViewport] = useState({ width: 0, scrollLeft: 0 });
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
    const ends = [
      a.finishDate,
      state.project.deadline,
      a.today,
      ...order.map((id) => indexToDate(a.tasks[id].lf - 1)),
    ];
    if (impact) {
      starts.push(...Object.values(b.tasks).map((t) => t.startDate));
      ends.push(b.finishDate);
    }
    for (const t of state.tasks) if (t.dueDate) ends.push(t.dueDate);
    const start = addCalendarDays(minDate(starts), -2);
    const end = addCalendarDays(maxDate(ends), 7);
    return { start, days: diffCalendarDays(start, end) + 1 };
  }, [state, a, b, impact, order]);

  // Связанные с задачей под курсором (или в фокусе): её предшественники и последователи.
  const hovered = hoverId && byId.has(hoverId) ? hoverId : null;
  const linked = useMemo(() => {
    if (!hovered) return null;
    const ids = new Set<string>([hovered]);
    const deps = new Set<string>();
    for (const d of state.dependencies) {
      if (d.predecessorId === hovered || d.successorId === hovered) {
        ids.add(d.predecessorId);
        ids.add(d.successorId);
        deps.add(d.id);
      }
    }
    return { ids, deps };
  }, [hovered, state.dependencies]);

  const autoW = viewport.width > 0 ? Math.floor((viewport.width - LEFT - 16) / range.days) : 26;
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
    const update = () =>
      setViewport({ width: scroller.clientWidth, scrollLeft: scroller.scrollLeft });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(scroller);
    scroller.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      scroller.removeEventListener('scroll', update);
    };
  }, [hasTasks]);

  if (order.length === 0) return <EmptyTimeline />;

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
  const todayIdx = diffCalendarDays(range.start, a.today);

  return (
    <div
      ref={rootRef}
      className="relative bg-surface"
      style={{ width: LEFT + width, minHeight: '100%' }}
    >
      {/* Шапка: месяцы, дни, отдельная дорожка для меток «сегодня» и «дедлайн» — они не перекрывают даты */}
      <div className="sticky top-0 z-20 flex">
        <div
          className="sticky left-0 z-30 flex items-end justify-between border-r border-b border-line bg-surface pr-2 pb-2 pl-4"
          style={{ width: LEFT, height: HEADER }}
        >
          <span className="pb-1 text-[13px] font-medium text-ink-3">Задачи</span>
          <div className="flex items-center">
            <Popover
              label="Обозначения"
              iconOnly
              align={roomy ? 'start' : 'end'}
              buttonClassName="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 transition-colors duration-150 hover:bg-sunken hover:text-ink active:bg-pressed aria-expanded:bg-sunken aria-expanded:text-ink"
              button={<CircleHelp size={15} />}
              panelClassName="w-72 max-w-[calc(100vw-16px)] p-3"
            >
              {() => <Legend />}
            </Popover>
            {zoom !== null && (
              <IconButton
                label="Вписать весь план в экран"
                className="h-7 w-7"
                onClick={() => setZoom(null)}
              >
                <Maximize2 size={14} />
              </IconButton>
            )}
            <IconButton
              label="Уменьшить масштаб"
              className="h-7 w-7"
              disabled={dayW <= MIN_DAY_W}
              onClick={() => setZoom(Math.max(MIN_DAY_W, dayW - 4))}
            >
              <Minus size={14} />
            </IconButton>
            <IconButton
              label="Увеличить масштаб"
              className="h-7 w-7"
              disabled={dayW >= 56}
              onClick={() => setZoom(Math.min(56, dayW + 6))}
            >
              <Plus size={14} />
            </IconButton>
          </div>
        </div>
        <div className="border-b border-line bg-surface">
          <svg width={width} height={HEADER} className="block">
            {days.map((d, i) => {
              const first = i === 0 || d.endsWith('-01');
              const today = i === todayIdx;
              return (
                <g key={d}>
                  {isWeekend(d) && (
                    <rect x={i * dayW} y={18} width={dayW} height={20} fill={WEEKEND} />
                  )}
                  {first && (
                    <text
                      x={i * dayW + 6}
                      y={13}
                      fontSize={12}
                      fontWeight={600}
                      fill="var(--color-ink-2)"
                    >
                      {fmtMonth(d)}
                    </text>
                  )}
                  {first && i > 0 && (
                    <line
                      x1={i * dayW}
                      x2={i * dayW}
                      y1={0}
                      y2={HEADER}
                      stroke="var(--color-line)"
                    />
                  )}
                  {(dayW >= 18 || isMonday(d) || today) && (
                    <text
                      x={i * dayW + dayW / 2}
                      y={32}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={today ? 700 : 400}
                      fill={
                        today
                          ? 'var(--color-cobalt)'
                          : isWeekend(d)
                            ? 'var(--color-ink-3)'
                            : 'var(--color-ink-2)'
                      }
                    >
                      {Number(d.slice(8))}
                    </text>
                  )}
                </g>
              );
            })}
            <HeaderMark x={todayX + dayW / 2} anchor="middle" tone="cobalt" label="сегодня" />
            <HeaderMark
              x={deadlineX}
              anchor="end"
              tone="crimson"
              label={`дедлайн ${fmtDate(state.project.deadline)}`}
            />
          </svg>
        </div>
      </div>

      <div className="flex">
        {/* Список задач */}
        <div
          className="sticky left-0 z-10 border-r border-line bg-surface"
          style={{ width: LEFT }}
          onMouseLeave={() => setHoverId(null)}
        >
          {order.map((id) => {
            const t = byId.get(id)!;
            return (
              <TaskRow
                key={id}
                task={t}
                sched={a.tasks[id]}
                person={t.assigneeId ? peopleById.get(t.assigneeId) : undefined}
                selected={selectedId === id}
                shifted={affected.has(id)}
                linked={linked !== null && linked.ids.has(id) && id !== hovered}
                flashKey={flash.ids.has(id) ? flash.stamp : 0}
                roomy={roomy}
                onSelect={select}
                onHover={setHoverId}
              />
            );
          })}
        </div>

        {/* Поле диаграммы */}
        <svg width={width} height={height} className="block" onMouseLeave={() => setHoverId(null)}>
          <defs>
            {Object.values(EDGE).map((e) => (
              <marker
                key={e.marker}
                id={e.marker}
                viewBox="0 0 8 8"
                refX={7}
                refY={4}
                markerWidth={7}
                markerHeight={7}
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" fill={e.color} />
              </marker>
            ))}
            <pattern
              id="ghost-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-idle)" strokeWidth="1.5" />
            </pattern>
          </defs>

          {days.map((d, i) =>
            isWeekend(d) ? (
              <rect key={d} x={i * dayW} y={0} width={dayW} height={height} fill={WEEKEND} />
            ) : null,
          )}
          {order.map((id, i) => {
            const fill =
              selectedId === id
                ? 'var(--color-cobalt-soft)'
                : hovered === id || linked?.ids.has(id)
                  ? 'var(--color-sunken)'
                  : null;
            return (
              <g key={id}>
                {fill && <rect x={0} y={i * ROW} width={width} height={ROW} fill={fill} />}
                <line
                  x1={0}
                  x2={width}
                  y1={(i + 1) * ROW}
                  y2={(i + 1) * ROW}
                  stroke="var(--color-line-soft)"
                />
              </g>
            );
          })}

          {/* Вспышка пересчёта: строки, где только что сменились даты */}
          {order.map((id, i) =>
            flash.ids.has(id) ? (
              <rect
                key={`${id}-${flash.stamp}`}
                className="recalc-flash"
                x={0}
                y={i * ROW}
                width={width}
                height={ROW}
                fill="var(--color-wave)"
                fillOpacity={0.16}
              />
            ) : null,
          )}

          <rect
            x={todayX}
            y={0}
            width={dayW}
            height={height}
            fill="var(--color-cobalt)"
            opacity={0.05}
          />
          <line
            x1={todayX}
            x2={todayX}
            y1={0}
            y2={height}
            stroke="var(--color-cobalt)"
            strokeWidth={1.5}
          />
          <line
            x1={deadlineX}
            x2={deadlineX}
            y1={0}
            y2={height}
            stroke="var(--color-crimson)"
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />

          {/* Связи */}
          <g>
            {state.dependencies.map((d) => {
              if (!rowOf.has(d.predecessorId) || !rowOf.has(d.successorId)) return null;
              return (
                <DependencyPath
                  key={d.id}
                  dep={d}
                  p={barGeom(d.predecessorId)}
                  s={barGeom(d.successorId)}
                  edge={edgeOf(d)}
                  dimmed={linked !== null && !linked.deps.has(d.id)}
                />
              );
            })}
          </g>

          {/* Призраки прежних дат */}
          {impact &&
            order.map((id) => {
              const imp = affected.get(id);
              if (
                !imp ||
                imp.created ||
                (imp.deltaStart === 0 && imp.deltaEnd === 0) ||
                !b.tasks[id]
              )
                return null;
              const g = barGeom(id, 'before');
              if (g.milestone) {
                const cy = g.y + BAR_H / 2;
                return (
                  <path
                    key={id}
                    d={`M${g.x2},${cy - 8} l8,8 l-8,8 l-8,-8 z`}
                    fill="none"
                    stroke="var(--color-idle)"
                    strokeDasharray="3 2"
                  />
                );
              }
              return (
                <rect
                  key={id}
                  x={g.x1}
                  y={g.y}
                  width={Math.max(4, g.x2 - g.x1)}
                  height={BAR_H}
                  rx={4}
                  fill="url(#ghost-hatch)"
                  stroke="var(--color-idle)"
                  strokeDasharray="4 3"
                />
              );
            })}

          {/* Полосы задач */}
          {order.map((id) => {
            const t = byId.get(id)!;
            const g = barGeom(id);
            return (
              <TaskBar
                key={id}
                task={t}
                sched={g.s}
                imp={affected.get(id)}
                y={g.y}
                x1={g.x1}
                x2={g.x2}
                milestone={g.milestone}
                floatEndX={x(indexToDate(g.s.lf - 1)) + dayW}
                dueX={t.dueDate ? x(t.dueDate) + dayW : null}
                todayX={todayX}
                selected={selectedId === id}
                dimmed={linked !== null && !linked.ids.has(id)}
                onSelect={select}
                onHover={setHoverId}
              />
            );
          })}
        </svg>
      </div>

      {/* На узком (обычно сенсорном) экране карточка перекрывала бы поповеры — там хватает шторки. */}
      {hovered && roomy && (
        <HoverCard
          id={hovered}
          geom={barGeom(hovered)}
          left={LEFT}
          minLeft={viewport.scrollLeft + LEFT + 8}
          maxLeft={viewport.scrollLeft + viewport.width - CARD_W - 12}
          bodyHeight={height}
        />
      )}
    </div>
  );

  function edgeOf(d: Dependency) {
    if (linked?.deps.has(d.id)) return EDGE.linked;
    const drv = a.tasks[d.successorId].driver;
    const wave =
      affected.has(d.successorId) && drv.kind === 'dependency' && drv.dependencyId === d.id;
    return wave ? EDGE.wave : critDeps.has(d.id) ? EDGE.critical : EDGE.plain;
  }
}

function EmptyTimeline() {
  const addTask = useAddTask();
  return (
    <Empty
      title="Задач пока нет"
      action={
        <Button variant="primary" onClick={addTask}>
          <Plus size={16} /> Добавить задачу
        </Button>
      }
    >
      Сроки посчитаются сами из длительности задач и связей между ними.
    </Empty>
  );
}

/** Метка на нижней дорожке шапки: пилюля с текстом у вертикальной линии. */
function HeaderMark({
  x,
  anchor,
  tone,
  label,
}: {
  x: number;
  anchor: 'middle' | 'end';
  tone: 'cobalt' | 'crimson';
  label: string;
}) {
  const w = label.length * 6.2 + 12;
  const left = Math.max(2, anchor === 'middle' ? x - w / 2 : x - w);
  return (
    <g>
      <rect
        x={left}
        y={39}
        width={w}
        height={15}
        rx={4}
        fill={tone === 'cobalt' ? 'var(--color-cobalt-soft)' : 'var(--color-crimson)'}
      />
      <text
        x={left + w / 2}
        y={50}
        textAnchor="middle"
        fontSize={10.5}
        fontWeight={600}
        fill={tone === 'cobalt' ? 'var(--color-cobalt-deep)' : '#fff'}
      >
        {label}
      </text>
    </g>
  );
}

const DependencyPath = memo(function DependencyPath({
  dep,
  p,
  s,
  edge,
  dimmed,
}: {
  dep: Dependency;
  p: { y: number; x2: number; milestone: boolean };
  s: { y: number; x1: number; milestone: boolean };
  edge: (typeof EDGE)[keyof typeof EDGE];
  dimmed: boolean;
}) {
  const x1 = p.milestone ? p.x2 + 7 : p.x2;
  const y1 = p.y + BAR_H / 2;
  const x2 = s.milestone ? s.x1 - 8 : s.x1;
  const y2 = s.y + BAR_H / 2;
  const rowBoundary = Math.max(p.y, s.y) - (ROW - BAR_H) / 2;
  const path =
    x2 - x1 >= 14
      ? `M${x1},${y1} H${x1 + 7} V${y2} H${x2 - 1}`
      : `M${x1},${y1} H${x1 + 7} V${rowBoundary} H${x2 - 9} V${y2} H${x2 - 1}`;
  return (
    <path
      data-dep={dep.id}
      d={path}
      fill="none"
      stroke={edge.color}
      strokeWidth={edge === EDGE.plain ? 1.25 : 1.75}
      strokeLinejoin="round"
      markerEnd={`url(#${edge.marker})`}
      style={{ opacity: dimmed ? 0.2 : 1, transition: 'opacity 150ms ease-out' }}
    />
  );
});

/** Строка списка задач: выбор задачи, быстрая правка длительности, признаки риска. */
const TaskRow = memo(function TaskRow({
  task: t,
  sched: s,
  person,
  selected,
  shifted,
  linked,
  flashKey,
  roomy,
  onSelect,
  onHover,
}: {
  task: Task;
  sched: TaskSchedule;
  person: Person | undefined;
  selected: boolean;
  shifted: boolean;
  linked: boolean;
  flashKey: number;
  roomy: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  return (
    <div
      className={cx(
        'relative flex items-center border-b border-line-soft transition-colors duration-150',
        selected
          ? 'bg-cobalt-soft'
          : linked
            ? 'bg-sunken'
            : shifted
              ? 'bg-wave-soft'
              : 'hover:bg-sunken',
      )}
      style={{ height: ROW }}
      onMouseEnter={() => onHover(t.id)}
    >
      {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-cobalt" />}
      {flashKey > 0 && (
        <span key={flashKey} aria-hidden className="recalc-flash absolute inset-0 bg-wave/15" />
      )}
      <button
        type="button"
        onClick={() => onSelect(t.id)}
        onFocus={() => onHover(t.id)}
        onBlur={() => onHover(null)}
        aria-pressed={selected}
        className="relative flex h-full min-w-0 flex-1 items-center gap-2 pr-1 pl-4 text-left text-sm focus-visible:outline-offset-[-2px]"
      >
        <StatusDot status={t.status} />
        <span
          className={cx('min-w-0 flex-1 truncate', t.status === 'done' ? 'text-ink-3' : 'text-ink')}
          title={`${t.name}: ${STATUS_LABEL[t.status]}`}
        >
          {t.name}
        </span>
      </button>
      <span className="relative flex shrink-0 items-center gap-1 pr-2">
        {s.flags.critical && (
          <Tooltip content={GLOSSARY.critical}>
            <span className="flex">
              <Flame size={14} className="text-crimson" aria-label="На критическом пути" />
            </span>
          </Tooltip>
        )}
        {roomy && s.risk === 'high' && (
          <Tooltip content={GLOSSARY.threatened}>
            <span className="flex">
              <AlertTriangle size={14} className="text-crimson" aria-label="Под угрозой" />
            </span>
          </Tooltip>
        )}
        {roomy && s.flags.overloaded && (
          <Tooltip content={GLOSSARY.overloaded}>
            <span className="flex">
              <Users size={14} className="text-wave-deep" aria-label="Исполнитель перегружен" />
            </span>
          </Tooltip>
        )}
        <DurationButton task={t} align={roomy ? 'end' : 'start'} />
        {roomy && <Avatar person={person ?? null} size={20} />}
      </span>
    </div>
  );
});

/** Длительность в строке: по клику — поповер со степпером, правка сразу идёт в черновик. */
function DurationButton({ task, align }: { task: Task; align: 'start' | 'end' }) {
  const propose = usePropose();
  const setDuration = (n: number) =>
    propose({ type: 'updateTask', taskId: task.id, patch: { durationDays: Math.max(0, n) } });
  const label = task.durationDays > 0 ? fmtDays(task.durationDays) : 'веха';
  return (
    <Popover
      label={`Длительность «${task.name}»: ${label}. Изменить`}
      align={align}
      buttonClassName="h-6 min-w-11 rounded-md px-1.5 text-right text-[12px] font-medium whitespace-nowrap text-ink-2 tabular-nums transition-colors duration-150 hover:bg-pressed hover:text-ink active:bg-pressed aria-expanded:bg-pressed aria-expanded:text-ink"
      button={label}
      panelClassName="w-60 p-3"
    >
      {(close) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <p className="text-[13px] font-medium text-ink-2">Длительность, раб. дней</p>
          <div className="mt-2 flex">
            <button
              type="button"
              aria-label="Меньше на день"
              disabled={task.durationDays <= 0}
              className="flex h-9 w-9 items-center justify-center rounded-l-lg border border-line text-ink-2 transition-colors duration-150 hover:bg-sunken active:bg-pressed disabled:opacity-45"
              onClick={() => setDuration(task.durationDays - 1)}
            >
              <Minus size={14} />
            </button>
            <input
              type="number"
              min={0}
              autoFocus
              aria-label="Длительность в рабочих днях"
              className="no-spin h-9 w-full min-w-0 border-y border-line text-center text-sm outline-none focus:border-cobalt"
              value={task.durationDays}
              onChange={(e) => setDuration(Math.round(Number(e.target.value) || 0))}
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              aria-label="Больше на день"
              className="flex h-9 w-9 items-center justify-center rounded-r-lg border border-line text-ink-2 transition-colors duration-150 hover:bg-sunken active:bg-pressed"
              onClick={() => setDuration(task.durationDays + 1)}
            >
              <Plus size={14} />
            </button>
          </div>
          <p className="mt-2 text-[12px] leading-4 text-ink-3">
            Сроки пересчитываются сразу, план меняется после «Применить».
          </p>
          <Button type="submit" size="sm" variant="secondary" className="mt-3 w-full">
            Готово
          </Button>
        </form>
      )}
    </Popover>
  );
}

const TaskBar = memo(function TaskBar({
  task: t,
  sched: s,
  imp,
  y,
  x1,
  x2,
  milestone,
  floatEndX,
  dueX,
  todayX,
  selected,
  dimmed,
  onSelect,
  onHover,
}: {
  task: Task;
  sched: TaskSchedule;
  imp: TaskImpact | undefined;
  y: number;
  x1: number;
  x2: number;
  milestone: boolean;
  floatEndX: number;
  dueX: number | null;
  todayX: number;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const shifted = imp && (imp.deltaEnd !== 0 || imp.deltaStart !== 0 || imp.created);
  const delay = imp ? (imp.chain.length - 1) * 60 : 0;
  const crit = s.flags.critical;
  const fill = shifted ? 'var(--color-wave)' : FILL[t.status];
  // Критичность видна всегда — и у сдвинутой черновиком задачи: красная рамка поверх заливки.
  const stroke = selected
    ? 'var(--color-ink)'
    : crit
      ? 'var(--color-crimson)'
      : shifted
        ? 'var(--color-wave-deep)'
        : t.status === 'not_started'
          ? 'var(--color-idle)'
          : t.status === 'done'
            ? '#9fcdb4'
            : fill;
  const w = Math.max(4, x2 - x1);
  const cy = y + BAR_H / 2;

  return (
    <g
      style={{
        cursor: 'pointer',
        opacity: dimmed ? 0.45 : 1,
        transition: 'opacity 150ms ease-out',
      }}
      onClick={() => onSelect(t.id)}
      onMouseEnter={() => onHover(t.id)}
    >
      <g
        key={`${imp ? imp.deltaEnd : 0}`}
        className={shifted ? 'wave-in' : undefined}
        style={{ animationDelay: `${delay}ms` }}
      >
        {/* Невидимая зона наведения: карточка не мерцает между полосой и резервом */}
        <rect
          x={Math.min(x1, x2) - 10}
          y={y - 8}
          width={w + 20}
          height={BAR_H + 16}
          fill="transparent"
        />
        {t.status !== 'done' && s.float > 0 && !milestone && (
          <g stroke="var(--color-idle)" strokeWidth={1.2}>
            <line x1={x2} x2={floatEndX} y1={cy} y2={cy} strokeDasharray="2 3" />
            <line x1={floatEndX} x2={floatEndX} y1={cy - 4} y2={cy + 4} />
          </g>
        )}
        {milestone ? (
          <path
            d={`M${x2},${cy - 9} l9,9 l-9,9 l-9,-9 z`}
            fill={
              shifted ? 'var(--color-wave)' : crit ? 'var(--color-crimson)' : 'var(--color-ink)'
            }
            stroke={
              selected ? 'var(--color-ink)' : crit && shifted ? 'var(--color-crimson)' : 'none'
            }
            strokeWidth={2}
          />
        ) : (
          <>
            <rect
              x={x1}
              y={y}
              width={w}
              height={BAR_H}
              rx={4}
              fill={fill}
              stroke={stroke}
              strokeWidth={crit || selected ? 2 : 1}
            />
            {t.status === 'in_progress' && !shifted && todayX > x1 && (
              <rect
                x={x1}
                y={y}
                width={Math.min(w, todayX - x1)}
                height={BAR_H}
                rx={4}
                fill="var(--color-cobalt-deep)"
                opacity={0.55}
              />
            )}
            {w >= 44 && (
              <text
                x={x1 + 7}
                y={cy + 4}
                fontSize={11}
                fontWeight={600}
                fill={shifted ? 'var(--color-ink)' : LABEL[t.status]}
              >
                {t.durationDays} дн.
              </text>
            )}
          </>
        )}
        {dueX !== null && (
          <g>
            <line
              x1={dueX}
              x2={dueX}
              y1={y - 5}
              y2={y + BAR_H + 5}
              stroke={s.flags.missesDueDate ? 'var(--color-crimson)' : 'var(--color-ink-2)'}
              strokeWidth={1.5}
            />
            <path
              d={`M${dueX},${y - 5} l7,3 l-7,3 z`}
              fill={s.flags.missesDueDate ? 'var(--color-crimson)' : 'var(--color-ink-2)'}
            />
          </g>
        )}
        {imp && imp.deltaEnd !== 0 && (
          <g transform={`translate(${Math.max(x2, dueX ?? 0) + (milestone ? 14 : 8)}, ${y})`}>
            <rect
              width={imp.deltaEnd > 0 ? 50 : 46}
              height={BAR_H}
              rx={4}
              fill={imp.deltaEnd > 0 ? 'var(--color-wave-soft)' : 'var(--color-moss-soft)'}
              stroke={imp.deltaEnd > 0 ? 'var(--color-wave)' : 'var(--color-moss)'}
              strokeOpacity={0.4}
            />
            <text
              x={imp.deltaEnd > 0 ? 25 : 23}
              y={13}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill={imp.deltaEnd > 0 ? 'var(--color-wave-deep)' : 'var(--color-moss)'}
            >
              {fmtDays(imp.deltaEnd, true)}
            </text>
          </g>
        )}
      </g>
    </g>
  );
});

/** Карточка задачи при наведении: даты, резерв, сдвиг — без клика и без перехода в редактор. */
function HoverCard({
  id,
  geom,
  left: listW,
  minLeft,
  maxLeft,
  bodyHeight,
}: {
  id: string;
  geom: { y: number; x1: number; x2: number };
  left: number;
  minLeft: number;
  maxLeft: number;
  bodyHeight: number;
}) {
  const { state, analysis: a, impact } = useModel();
  const t = state.tasks.find((x) => x.id === id);
  const s = a.tasks[id];
  if (!t || !s) return null;
  const person = state.people.find((p) => p.id === t.assigneeId);
  const imp = impact?.affected.find((x) => x.taskId === id);
  const below = geom.y + BAR_H + 150 < bodyHeight;
  // Карточка остаётся в видимой части диаграммы, даже если полоса у правого края.
  const left = Math.max(minLeft, Math.min(listW + geom.x1, maxLeft));
  const top = HEADER + (below ? geom.y + BAR_H + 10 : geom.y - 10);

  return (
    // Внешний слой позиционирует (над или под полосой), внутренний — анимирует появление.
    <div
      className="pointer-events-none absolute z-40"
      style={{ left, top, width: CARD_W, transform: below ? undefined : 'translateY(-100%)' }}
    >
      <div
        role="tooltip"
        className="animate-pop-in rounded-xl border border-line bg-surface p-3 shadow-float"
      >
        <div className="flex items-start gap-2">
          <span className="mt-1.5">
            <StatusDot status={t.status} />
          </span>
          <p className="min-w-0 flex-1 text-sm leading-5 font-semibold">{t.name}</p>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
          <Avatar person={person} size={18} />
          <span className="truncate">{person?.name ?? 'Не назначен'}</span>
          <span className="ml-auto shrink-0 text-ink-3">{STATUS_LABEL[t.status]}</span>
        </div>
        <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line-soft pt-2.5 text-[13px]">
          <dt className="text-ink-3">Сроки</dt>
          <dd className="text-right font-medium">
            {fmtDate(s.startDate)} — {fmtDate(s.endDate)}
          </dd>
          <dt className="text-ink-3">Длительность</dt>
          <dd className="text-right font-medium">
            {t.durationDays > 0 ? fmtDays(t.durationDays) : 'веха'}
          </dd>
          {t.status !== 'done' && (
            <>
              <dt className="text-ink-3">Резерв</dt>
              <dd className={cx('text-right font-medium', s.flags.critical && 'text-crimson')}>
                {s.flags.critical ? 'нет' : fmtDays(s.float)}
              </dd>
              <dt className="text-ink-3">Запас прочности</dt>
              <dd
                className={cx('text-right font-medium', safetyMargin(s, a) <= 0 && 'text-crimson')}
              >
                {fmtDays(safetyMargin(s, a))}
              </dd>
            </>
          )}
          {t.dueDate && (
            <>
              <dt className="text-ink-3">Срок задачи</dt>
              <dd className={cx('text-right font-medium', s.flags.missesDueDate && 'text-crimson')}>
                {fmtDate(t.dueDate)}
              </dd>
            </>
          )}
        </dl>
        {imp && imp.deltaEnd !== 0 && (
          <div className="mt-2.5">
            <Chip tone={imp.deltaEnd > 0 ? 'wave' : 'moss'}>
              окончание {fmtDays(imp.deltaEnd, true)}: {fmtDate(imp.endBefore)} →{' '}
              {fmtDate(imp.endAfter)}
            </Chip>
          </div>
        )}
      </div>
    </div>
  );
}

function Legend() {
  const item = (swatch: ReactNode, label: ReactNode) => (
    <li className="flex items-center gap-2.5">
      <span className="flex w-6 shrink-0 justify-center">{swatch}</span>
      <span>{label}</span>
    </li>
  );
  const box = (bg: string, border?: string) => (
    <span
      className="inline-block h-3 w-6 rounded-[4px]"
      style={{ background: bg, border: border ? `2px solid ${border}` : undefined }}
    />
  );
  return (
    <>
      <p className="mb-2 text-sm font-semibold">Обозначения</p>
      <ul className="grid grid-cols-1 gap-1.5 text-[13px] text-ink-2">
        {item(box(FILL.done, '#9fcdb4'), 'Выполнена')}
        {item(box(FILL.in_progress), 'В работе')}
        {item(box(FILL.not_started, 'var(--color-idle)'), 'Не начата')}
        {item(box(FILL.blocked), 'Заблокирована')}
        {item(box(FILL.not_started, 'var(--color-crimson)'), 'На критическом пути')}
        {item(box('var(--color-wave)'), 'Сдвинута изменением из черновика')}
        {item(box('transparent', 'var(--color-idle)'), 'Прежние даты до изменения')}
        {item(
          <span className="inline-block w-6 border-t-2 border-dotted border-idle" />,
          'Резерв: насколько можно сдвинуть',
        )}
        {item(<span className="inline-block h-3.5 w-0.5 bg-ink-2" />, 'Срок задачи')}
        {item(<span className="inline-block h-3.5 w-0.5 bg-cobalt" />, 'Сегодня')}
        {item(
          <span className="inline-block h-3.5 border-l-2 border-dashed border-crimson" />,
          'Дедлайн проекта',
        )}
      </ul>
      <p className="mt-2.5 border-t border-line-soft pt-2.5 text-[12px] leading-4 text-ink-3">
        Наведите на задачу, чтобы выделить её связи. Число дней в строке меняет длительность.
      </p>
    </>
  );
}
