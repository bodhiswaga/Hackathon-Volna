import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  CircleHelp,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  addCalendarDays,
  diffCalendarDays,
  endIndex,
  indexToDate,
  isWeekend,
  parseDate,
  safetyMargin,
  startIndex,
  TASK_STATUSES,
  type Dependency,
  type ISODate,
  type Person,
  type Task,
  type TaskImpact,
  type TaskSchedule,
  type TaskStatus,
} from '@volna/engine';
import { useAddTask, useModel, usePropose, useRecalcFlash } from '../../lib/model';
import { fmtDate, fmtDays, fmtMonth, fmtRange, newId, STATUS_LABEL } from '../../lib/format';
import { GLOSSARY } from '../../lib/glossary';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { toast, useDraft } from '../../store/draft';
import { StatusPicker } from '../task/StatusPicker';
import {
  Avatar,
  Button,
  Chip,
  cx,
  Empty,
  IconButton,
  Popover,
  STATUS_ICON,
  StatusBadge,
  Tooltip,
} from '../ui';

const ROW = 40;
const HEADER = 56;
const MIN_DAY_W = 8;
const BAR_H = 18;
const CARD_W = 264;

// Полосы по статусу: не начата — контур, в работе — акцент, блок — штриховка, готово — зелёная.
// Сдвинутые черновиком — оранжевые, но иконка статуса внутри остаётся.
const FILL = {
  done: 'var(--color-done-bar)',
  in_progress: 'var(--color-cobalt)',
  blocked: 'url(#blocked-hatch)',
  not_started: 'var(--color-surface)',
} as const;
const STROKE = {
  done: 'var(--color-moss)',
  in_progress: 'var(--color-cobalt-deep)',
  blocked: 'var(--color-ochre-bar)',
  not_started: 'var(--color-line-strong)',
} as const;
const LABEL = {
  done: 'var(--color-ink)',
  in_progress: 'var(--color-surface)',
  blocked: 'var(--color-ink)',
  not_started: 'var(--color-ink-2)',
} as const;
const ICON_ON_BAR = {
  done: 'var(--color-moss)',
  in_progress: 'var(--color-surface)',
  blocked: 'var(--color-ochre)',
  not_started: 'var(--color-ink-3)',
} as const;

const EDGE = {
  plain: { color: 'var(--color-idle)', marker: 'arrow-plain' },
  critical: { color: 'var(--color-crimson)', marker: 'arrow-critical' },
  wave: { color: 'var(--color-wave)', marker: 'arrow-wave' },
  linked: { color: 'var(--color-ink)', marker: 'arrow-linked' },
} as const;

const WEEKEND = 'rgb(21 24 30 / 0.025)';

const HINT_KEY = 'volna:timeline-hint-hidden';

type Drag =
  | { kind: 'resize'; id: string; dur: number; from: number }
  | { kind: 'link'; id: string; x: number; y: number; target: string | null };

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
  // Подсветка задач одного статуса по клику на сводку над таймлайном.
  const [statusFocus, setStatusFocus] = useState<TaskStatus | null>(null);
  const [depId, setDepId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const propose = usePropose();

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

  // Перетаскивание: слушатели на окне живут, пока идёт жест; свежие размеры берутся из ref.
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const lastDragEnd = useRef(0);
  const live = useRef({
    toDur: (_px: number, _id: string): number => 0,
    rowAt: (_py: number): string | null => null,
    commit: (_d: Drag) => {},
  });
  live.current = {
    toDur: (px, id) => {
      const date = addCalendarDays(range.start, Math.floor(px / dayW));
      const es = a.tasks[id].es;
      // Задача в работе не может закончиться раньше завтра — как в движке (EF ≥ сегодня + 1).
      const min = byId.get(id)?.status === 'in_progress' ? startIndex(a.today) + 1 - es : 1;
      return Math.max(1, min, endIndex(date) - es);
    },
    rowAt: (py) => {
      const r = Math.floor(py / ROW);
      return r >= 0 && r < order.length ? order[r]! : null;
    },
    commit: (d) => {
      if (d.kind === 'resize') {
        if (d.dur !== d.from) {
          propose({ type: 'updateTask', taskId: d.id, patch: { durationDays: d.dur } });
        }
      } else if (d.target) {
        propose({
          type: 'addDependency',
          dependency: {
            id: newId(),
            projectId: state.project.id,
            predecessorId: d.id,
            successorId: d.target,
            lagDays: 0,
          },
        });
      }
    },
  };
  const dragging = drag ? `${drag.kind}:${drag.id}` : null;
  useEffect(() => {
    if (!dragging) return;
    const point = (e: PointerEvent) => {
      const r = svgRef.current?.getBoundingClientRect();
      return { px: e.clientX - (r?.left ?? 0), py: e.clientY - (r?.top ?? 0) };
    };
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const { px, py } = point(e);
      if (d.kind === 'resize') {
        const dur = live.current.toDur(px, d.id);
        if (dur !== d.dur) setDrag({ ...d, dur });
      } else {
        const target = live.current.rowAt(py);
        setDrag({ ...d, x: px, y: py, target: target === d.id ? null : target });
      }
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      lastDragEnd.current = Date.now();
      if (d) live.current.commit(d);
    };
    const cancel = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', cancel);
    };
  }, [dragging]);

  // Выбранная связь снимается по Esc.
  useEffect(() => {
    if (!depId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDepId(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [depId]);

  if (order.length === 0) return <EmptyTimeline />;

  const startResize = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const dur = byId.get(id)!.durationDays;
    setDepId(null);
    setDrag({ kind: 'resize', id, dur, from: dur });
  };
  const startLink = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const g = barGeom(id);
    const x0 = g.x2 + (g.milestone ? 20 : 11);
    setDepId(null);
    setDrag({ kind: 'link', id, x: x0, y: g.y + BAR_H / 2, target: null });
  };
  const removeDep = (id: string) => {
    const before = useDraft.getState().ops;
    if (propose({ type: 'removeDependency', dependencyId: id })) {
      toast('Связь убрана', 'info', {
        action: { label: 'Отменить', onClick: () => useDraft.getState().setOps(before) },
      });
    }
    setDepId(null);
  };
  const selectBar = (id: string) => {
    if (Date.now() - lastDragEnd.current > 250) select(id);
  };
  const isDimmed = (id: string) =>
    linked !== null
      ? !linked.ids.has(id)
      : statusFocus !== null && byId.get(id)?.status !== statusFocus;

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
      <TimelineToolbar
        tasks={state.tasks}
        focus={statusFocus}
        onFocus={setStatusFocus}
        width={viewport.width}
        roomy={roomy}
      />
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
                  {(dayW >= 18 ||
                    today ||
                    // Понедельник рядом с «сегодня» не подписываем — цифры слиплись бы.
                    (isMonday(d) && Math.abs(i - todayIdx) * dayW >= 22)) && (
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
                dimmed={statusFocus !== null && t.status !== statusFocus}
                linkTarget={drag?.kind === 'link' && drag.target === id}
                flashKey={flash.ids.has(id) ? flash.stamp : 0}
                roomy={roomy}
                onSelect={select}
                onHover={setHoverId}
              />
            );
          })}
        </div>

        {/* Поле диаграммы */}
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className={cx('block touch-pan-y', drag && 'select-none')}
          style={{
            cursor: drag ? (drag.kind === 'resize' ? 'ew-resize' : 'crosshair') : undefined,
          }}
          onMouseLeave={() => !drag && setHoverId(null)}
          onClick={(e) => {
            if (e.target === e.currentTarget || (e.target as Element).hasAttribute('data-bg')) {
              setDepId(null);
            }
          }}
        >
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
            <pattern
              id="blocked-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="var(--color-ochre-soft)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-ochre-bar)" strokeWidth="2.5" />
            </pattern>
          </defs>

          {days.map((d, i) =>
            isWeekend(d) ? (
              <rect key={d} x={i * dayW} y={0} width={dayW} height={height} fill={WEEKEND} />
            ) : null,
          )}
          {order.map((id, i) => {
            const target = drag?.kind === 'link' && drag.target === id;
            const fill = target
              ? 'var(--color-cobalt-soft)'
              : selectedId === id
                ? 'var(--color-cobalt-soft)'
                : hovered === id || linked?.ids.has(id)
                  ? 'var(--color-sunken)'
                  : null;
            return (
              <g key={id}>
                {fill && <rect data-bg x={0} y={i * ROW} width={width} height={ROW} fill={fill} />}
                {target && (
                  <rect
                    x={1}
                    y={i * ROW + 1}
                    width={width - 2}
                    height={ROW - 2}
                    fill="none"
                    stroke="var(--color-cobalt)"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                  />
                )}
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
                  edge={depId === d.id ? EDGE.linked : edgeOf(d)}
                  dimmed={
                    depId !== null
                      ? depId !== d.id
                      : linked !== null
                        ? !linked.deps.has(d.id)
                        : statusFocus !== null
                  }
                  selected={depId === d.id}
                  onSelect={setDepId}
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
            const active = !drag && (hovered === id || selectedId === id);
            const showDue = t.dueDate && t.status !== 'done' && (active || g.s.flags.missesDueDate);
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
                dueX={showDue ? x(t.dueDate!) + dayW : null}
                todayX={todayX}
                selected={selectedId === id}
                active={active}
                dimmed={isDimmed(id)}
                editable={roomy}
                onSelect={selectBar}
                onHover={setHoverId}
                onResizeStart={startResize}
                onLinkStart={startLink}
              />
            );
          })}

          {/* Превью жеста: новая длительность или протягиваемая связь */}
          {drag?.kind === 'resize' &&
            (() => {
              const g = barGeom(drag.id);
              const s = a.tasks[drag.id];
              const endX = x(indexToDate(s.es + drag.dur - 1)) + dayW;
              const from = byId.get(drag.id)!.durationDays;
              const label = `${from} → ${drag.dur} раб. дн.`;
              const lw = label.length * 6.4 + 14;
              return (
                <g pointerEvents="none">
                  <rect
                    x={g.x1}
                    y={g.y - 2}
                    width={Math.max(4, endX - g.x1)}
                    height={BAR_H + 4}
                    rx={5}
                    fill="var(--color-cobalt)"
                    fillOpacity={0.12}
                    stroke="var(--color-cobalt)"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                  />
                  <g transform={`translate(${endX + 8}, ${g.y - 1})`}>
                    <rect width={lw} height={BAR_H + 2} rx={5} fill="var(--color-ink)" />
                    <text
                      x={lw / 2}
                      y={14}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill="var(--color-surface)"
                    >
                      {label}
                    </text>
                  </g>
                </g>
              );
            })()}
          {drag?.kind === 'link' &&
            (() => {
              const g = barGeom(drag.id);
              const x0 = g.x2 + (g.milestone ? 20 : 11);
              const y0 = g.y + BAR_H / 2;
              return (
                <g pointerEvents="none">
                  <line
                    x1={x0}
                    y1={y0}
                    x2={drag.x}
                    y2={drag.y}
                    stroke="var(--color-cobalt)"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                  />
                  <circle cx={x0} cy={y0} r={5} fill="var(--color-cobalt)" />
                  <circle cx={drag.x} cy={drag.y} r={4} fill="var(--color-cobalt)" />
                </g>
              );
            })()}
        </svg>
      </div>

      {/* На узком (обычно сенсорном) экране карточка перекрывала бы поповеры — там хватает шторки. */}
      {depId &&
        (() => {
          const d = state.dependencies.find((x) => x.id === depId);
          if (!d) return null;
          return (
            <div
              role="region"
              aria-label="Выбранная связь"
              className="animate-toast-in fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-lg bg-ink py-2 pr-2 pl-4 text-sm text-white shadow-float"
            >
              <span className="truncate">
                «{byId.get(d.predecessorId)?.name}» → «{byId.get(d.successorId)?.name}»
              </span>
              <Button size="sm" variant="danger-solid" onClick={() => removeDep(d.id)}>
                <Trash2 size={13} /> Убрать связь
              </Button>
              <button
                type="button"
                aria-label="Снять выделение связи"
                className="flex h-8 w-8 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white active:bg-white/15 outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
                onClick={() => setDepId(null)}
              >
                <X size={15} />
              </button>
            </div>
          );
        })()}

      {hovered && roomy && !drag && (
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
  selected,
  onSelect,
}: {
  dep: Dependency;
  p: { y: number; x2: number; milestone: boolean };
  s: { y: number; x1: number; milestone: boolean };
  edge: (typeof EDGE)[keyof typeof EDGE];
  dimmed: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
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
    <g>
      <path
        data-dep={dep.id}
        d={path}
        fill="none"
        stroke={edge.color}
        strokeWidth={selected ? 2.5 : edge === EDGE.plain ? 1.25 : 1.75}
        strokeLinejoin="round"
        markerEnd={`url(#${edge.marker})`}
        style={{ opacity: dimmed ? 0.2 : 1, transition: 'opacity 150ms ease-out' }}
      />
      {/* Широкая невидимая линия: по тонкой стрелке легко попасть мышью */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={10}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(dep.id);
        }}
      >
        <title>Нажмите, чтобы выбрать связь</title>
      </path>
    </g>
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
  dimmed,
  linkTarget,
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
  dimmed: boolean;
  linkTarget: boolean;
  flashKey: number;
  roomy: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  return (
    <div
      className={cx(
        'relative flex items-center border-b border-line-soft transition-[background-color,opacity] duration-150',
        selected || linkTarget
          ? 'bg-cobalt-soft'
          : linked
            ? 'bg-sunken'
            : shifted
              ? 'bg-wave-soft'
              : 'hover:bg-sunken',
        dimmed && 'opacity-45',
      )}
      style={{ height: ROW }}
      onMouseEnter={() => onHover(t.id)}
    >
      {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-cobalt" />}
      {flashKey > 0 && (
        <span key={flashKey} aria-hidden className="recalc-flash absolute inset-0 bg-wave/15" />
      )}
      <span className="relative flex shrink-0 pl-2.5">
        <StatusPicker task={t} size="sm" iconOnly />
      </span>
      <button
        type="button"
        onClick={() => onSelect(t.id)}
        onFocus={() => onHover(t.id)}
        onBlur={() => onHover(null)}
        aria-pressed={selected}
        className="relative flex h-full min-w-0 flex-1 items-center pr-1 pl-2 text-left text-sm focus-visible:outline-offset-[-2px]"
      >
        <span
          className={cx(
            'min-w-0 flex-1 truncate',
            t.status === 'done' ? 'text-ink-3 line-through decoration-ink-3/40' : 'text-ink',
          )}
          title={`${t.name}: ${STATUS_LABEL[t.status]}`}
        >
          {t.name}
        </span>
      </button>
      <span className="relative flex shrink-0 items-center gap-1 pr-2">
        {/* Один значок риска на строку: угроза важнее перегрузки; критичность видна по красной рамке полосы */}
        {s.risk === 'high' ? (
          <Tooltip content={GLOSSARY.threatened}>
            <span className="flex">
              <AlertTriangle size={14} className="text-crimson" aria-label="Под угрозой" />
            </span>
          </Tooltip>
        ) : roomy && s.flags.overloaded ? (
          <Tooltip content={GLOSSARY.overloaded}>
            <span className="flex">
              <Users size={14} className="text-wave-deep" aria-label="Исполнитель перегружен" />
            </span>
          </Tooltip>
        ) : null}
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
  active,
  dimmed,
  editable,
  onSelect,
  onHover,
  onResizeStart,
  onLinkStart,
}: {
  task: Task;
  sched: TaskSchedule;
  imp: TaskImpact | undefined;
  y: number;
  x1: number;
  x2: number;
  milestone: boolean;
  floatEndX: number;
  /** Метка срока «сдать до» (дата — в карточке): у задачи под курсором, выбранной или не успевающей к сроку. */
  dueX: number | null;
  todayX: number;
  selected: boolean;
  /** Под курсором или выбрана: видны ручки длительности и связи. */
  active: boolean;
  dimmed: boolean;
  /** Можно тянуть мышью (не на телефоне). */
  editable: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onResizeStart: (e: ReactPointerEvent, id: string) => void;
  onLinkStart: (e: ReactPointerEvent, id: string) => void;
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
        : STROKE[t.status];
  const w = Math.max(4, x2 - x1);
  const cy = y + BAR_H / 2;
  // Статус остаётся виден и у сдвинутой полосы: иконка внутри.
  const Icon = STATUS_ICON[t.status];
  const showIcon = !milestone && w >= 22;
  const canResize = editable && !milestone && t.status !== 'done';
  const linkX = x2 + (milestone ? 20 : 11);
  const showLink = editable && active;
  const missed = s.flags.missesDueDate;

  return (
    <g
      style={{
        cursor: 'pointer',
        opacity: dimmed ? 0.35 : 1,
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
        {/* Невидимая зона наведения: карточка не мерцает между полосой, резервом и ручками */}
        <rect
          x={Math.min(x1, x2) - 10}
          y={y - 8}
          width={w + 34}
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
              shifted
                ? 'var(--color-wave)'
                : t.status === 'done'
                  ? 'var(--color-moss)'
                  : crit
                    ? 'var(--color-crimson)'
                    : 'var(--color-ink)'
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
              strokeWidth={crit || selected ? 2 : 1.25}
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
            {showIcon && (
              <Icon
                x={x1 + 4}
                y={cy - 6}
                size={12}
                strokeWidth={2.6}
                color={shifted ? 'var(--color-ink)' : ICON_ON_BAR[t.status]}
                aria-hidden
              />
            )}
            {w >= 52 && (
              <text
                x={x1 + (showIcon ? 20 : 7)}
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
          <g pointerEvents="none">
            <line
              x1={dueX}
              x2={dueX}
              y1={y - 4}
              y2={y + BAR_H + 4}
              stroke={missed ? 'var(--color-crimson)' : 'var(--color-ink-2)'}
              strokeWidth={1.5}
              strokeDasharray={missed ? undefined : '3 2'}
            />
          </g>
        )}
        {imp && imp.deltaEnd !== 0 && (
          <g
            transform={`translate(${Math.max(x2, dueX ?? 0) + (milestone ? 14 : 8) + (showLink ? 20 : 0)}, ${y})`}
          >
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
      {/* Ручки: правый край — длительность, точка справа — новая связь */}
      {canResize && (
        <g style={{ cursor: 'ew-resize' }} onPointerDown={(e) => onResizeStart(e, t.id)}>
          <rect x={x2 - 6} y={y - 3} width={11} height={BAR_H + 6} fill="transparent" />
          {active && (
            <rect
              x={x2 - 4}
              y={y + 4}
              width={2.5}
              height={BAR_H - 8}
              rx={1.25}
              fill={
                t.status === 'in_progress' || shifted
                  ? 'var(--color-surface)'
                  : 'var(--color-ink-2)'
              }
            />
          )}
          <title>Потяните, чтобы изменить длительность</title>
        </g>
      )}
      {showLink && (
        <g
          style={{ cursor: 'crosshair' }}
          onPointerDown={(e) => onLinkStart(e, t.id)}
          onClick={(e) => e.stopPropagation()}
        >
          <circle cx={linkX} cy={cy} r={10} fill="transparent" />
          <circle
            cx={linkX}
            cy={cy}
            r={5}
            fill="var(--color-surface)"
            stroke="var(--color-cobalt)"
            strokeWidth={2}
          />
          <title>Потяните к другой задаче, чтобы связать</title>
        </g>
      )}
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
          <p className="min-w-0 flex-1 text-sm leading-5 font-semibold">{t.name}</p>
          <StatusBadge status={t.status} size="sm" />
        </div>
        <div className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
          <Avatar person={person} size={18} />
          <span className="truncate">{person?.name ?? 'Не назначен'}</span>
        </div>
        <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line-soft pt-2.5 text-[13px]">
          <dt className="text-ink-3">Даты</dt>
          <dd className="text-right font-medium">{fmtRange(s.startDate, s.endDate)}</dd>
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
              <dt className="text-ink-3">Сдать до</dt>
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

/** Образец полосы для легенды — те же цвета, что и на таймлайне. */
function BarSwatch({ status }: { status: TaskStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className="inline-flex h-3.5 w-7 shrink-0 items-center rounded-[4px] pl-0.5"
      style={{
        background:
          status === 'blocked'
            ? 'repeating-linear-gradient(45deg, var(--color-ochre-soft) 0 3px, var(--color-ochre-bar) 3px 5px)'
            : FILL[status],
        border: `1.25px solid ${STROKE[status]}`,
      }}
    >
      <Icon size={10} strokeWidth={2.8} color={ICON_ON_BAR[status]} aria-hidden />
    </span>
  );
}

const LEGEND_MARKS: { swatch: ReactNode; label: string }[] = [
  {
    swatch: (
      <span className="inline-block h-3.5 w-7 rounded-[4px] border-2 border-crimson bg-surface" />
    ),
    label: 'Критический путь',
  },
  {
    swatch: <span className="inline-block h-3.5 w-7 rounded-[4px] bg-wave" />,
    label: 'Сдвиг из черновика',
  },
];

// В развёрнутой легенде — ещё и то, что видно реже.
const LEGEND_MORE: { swatch: ReactNode; label: string }[] = [
  {
    swatch: <span className="inline-block h-3.5 border-l-2 border-dashed border-ink-2" />,
    label: 'Сдать до: срок задачи',
  },
  {
    swatch: (
      <span className="inline-block h-3.5 w-7 rounded-[4px] border border-dashed border-idle" />
    ),
    label: 'Прежние даты до изменения',
  },
  {
    swatch: <span className="inline-block w-7 border-t-2 border-dotted border-idle" />,
    label: 'Резерв: насколько можно сдвинуть',
  },
];

/**
 * Сводка статусов над таймлайном: сколько задач в каждом статусе; клик подсвечивает их.
 * Справа — обозначения (на широком экране всегда видны) и подсказка про перетаскивание.
 */
function TimelineToolbar({
  tasks,
  focus,
  onFocus,
  width,
  roomy,
}: {
  tasks: Task[];
  focus: TaskStatus | null;
  onFocus: (s: TaskStatus | null) => void;
  width: number;
  roomy: boolean;
}) {
  const wide = useMediaQuery('(min-width: 1536px)');
  const [hintHidden, setHintHidden] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) === '1';
    } catch {
      return false;
    }
  });
  const hideHint = () => {
    setHintHidden(true);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // Хранилище недоступно — подсказка вернётся при следующем открытии.
    }
  };
  const counts = Object.fromEntries(
    TASK_STATUSES.map((st) => [st, tasks.filter((t) => t.status === st).length]),
  ) as Record<TaskStatus, number>;
  const order: TaskStatus[] = ['in_progress', 'blocked', 'not_started', 'done'];
  return (
    <div
      className="sticky left-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-3 py-2"
      style={{ width: width || '100%' }}
    >
      <div
        role="group"
        aria-label="Задачи по статусам"
        className="flex flex-wrap items-center gap-1.5"
      >
        {order.map((st) => {
          const on = focus === st;
          return (
            <button
              key={st}
              type="button"
              aria-pressed={on}
              disabled={counts[st] === 0}
              onClick={() => onFocus(on ? null : st)}
              title={on ? 'Показать все задачи' : `Выделить: ${STATUS_LABEL[st].toLowerCase()}`}
              className={cx(
                'rounded-full outline-none transition-[box-shadow,opacity] duration-150 hover:brightness-[0.97] focus-visible:ring-2 focus-visible:ring-cobalt disabled:cursor-not-allowed disabled:opacity-45',
                on && 'ring-2 ring-cobalt',
                focus !== null && !on && 'opacity-60 hover:opacity-100',
              )}
            >
              <StatusBadge status={st} size="sm" count={counts[st]} />
            </button>
          );
        })}
        {focus && (
          <button
            type="button"
            onClick={() => onFocus(null)}
            className="ml-1 inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-[12px] text-ink-2 hover:bg-sunken"
          >
            <X size={12} /> Все
          </button>
        )}
      </div>
      {wide && (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2">
          {LEGEND_MARKS.map((m) => (
            <li key={m.label} className="flex items-center gap-1.5">
              {m.swatch}
              {m.label}
            </li>
          ))}
        </ul>
      )}
      {roomy && !hintHidden && (
        <p className="ml-auto flex items-center gap-1 text-[12px] text-ink-3">
          <MousePointer2 size={13} className="shrink-0" />
          Край полосы — длительность, точка справа — связь
          <IconButton label="Скрыть подсказку" className="h-6 w-6" onClick={hideHint}>
            <X size={12} />
          </IconButton>
        </p>
      )}
    </div>
  );
}

function Legend() {
  const item = (swatch: ReactNode, label: ReactNode) => (
    <li key={String(label)} className="flex items-center gap-2.5">
      <span className="flex w-7 shrink-0 justify-center">{swatch}</span>
      <span>{label}</span>
    </li>
  );
  return (
    <>
      <p className="mb-2 text-sm font-semibold">Обозначения</p>
      <ul className="grid grid-cols-1 gap-1.5 text-[13px] text-ink-2">
        {(['not_started', 'in_progress', 'blocked', 'done'] as const).map((st) =>
          item(<BarSwatch status={st} />, STATUS_LABEL[st]),
        )}
        {[...LEGEND_MARKS, ...LEGEND_MORE].map((m) => item(m.swatch, m.label))}
        {item(<span className="inline-block h-3.5 w-0.5 bg-cobalt" />, 'Сегодня')}
        {item(
          <span className="inline-block h-3.5 border-l-2 border-dashed border-crimson" />,
          'Дедлайн проекта',
        )}
        {item(<AlertTriangle size={14} className="text-crimson" />, 'Под угрозой: сорвёт срок')}
        {item(<Users size={14} className="text-wave-deep" />, 'Исполнитель перегружен')}
      </ul>
      <p className="mt-2.5 border-t border-line-soft pt-2.5 text-[12px] leading-4 text-ink-3">
        Значок слева — статус, нажмите, чтобы сменить. Тяните правый край полосы, чтобы изменить
        длительность, и точку справа от неё — чтобы связать с другой задачей. Нажмите на стрелку,
        чтобы убрать связь.
      </p>
    </>
  );
}
