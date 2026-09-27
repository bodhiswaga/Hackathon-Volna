import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Flame, Minus, Plus, Users } from 'lucide-react';
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
import { Avatar, cx, Empty, StatusDot } from '../ui';

const ROW = 44;
const HEADER = 52;
const LEFT = 300;
const BAR_H = 20;

const FILL = {
  done: '#2f9e6e',
  in_progress: '#2f54eb',
  blocked: '#b7791f',
  not_started: '#dfe4ec',
} as const;

const isMonday = (d: ISODate) => new Date(parseDate(d)).getUTCDay() === 1;
const minDate = (xs: ISODate[]) => xs.reduce((m, x) => (x < m ? x : m));
const maxDate = (xs: ISODate[]) => xs.reduce((m, x) => (x > m ? x : m));

export function GanttView() {
  const { state, analysis: a, baseAnalysis: b, impact } = useModel();
  const selectedId = useDraft((s) => s.selectedTaskId);
  const select = useDraft((s) => s.select);
  const [dayW, setDayW] = useState(26);
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

  const x = (d: ISODate) => diffCalendarDays(range.start, d) * dayW;
  const width = range.days * dayW;
  const height = order.length * ROW;
  const rowOf = new Map(order.map((id, i) => [id, i]));

  // При открытии вписываем весь план в ширину экрана (волна видна целиком).
  useLayoutEffect(() => {
    const scroller = rootRef.current?.parentElement;
    if (!scroller) return;
    const fit = Math.floor((scroller.clientWidth - LEFT - 16) / range.days);
    setDayW(Math.min(40, Math.max(12, fit)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (order.length === 0) {
    return (
      <Empty title="В проекте пока нет задач">
        Нажмите «Задача», чтобы добавить первую. Даты посчитаются сами из длительности и связей.
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
    const x2 = milestone ? x(s.endDate) + dayW : x(s.endDate) + dayW;
    return { s, y, x1: milestone ? x2 : x1, x2, milestone };
  };

  const deadlineX = x(state.project.deadline) + dayW;
  const todayX = x(a.today);

  return (
    <div ref={rootRef} className="relative bg-surface" style={{ width: LEFT + width, minHeight: '100%' }}>
      {/* Шапка */}
      <div className="sticky top-0 z-20 flex border-b border-line bg-surface">
        <div
          className="sticky left-0 z-30 flex items-end justify-between border-r border-line bg-surface px-4 pb-2"
          style={{ width: LEFT, height: HEADER }}
        >
          <span className="text-[12px] font-medium text-ink-3">Задачи в порядке выполнения</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label="Уменьшить масштаб"
              className="rounded p-1 text-ink-3 hover:bg-line-soft hover:text-ink"
              onClick={() => setDayW((w) => Math.max(12, w - 6))}
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              aria-label="Увеличить масштаб"
              className="rounded p-1 text-ink-3 hover:bg-line-soft hover:text-ink"
              onClick={() => setDayW((w) => Math.min(56, w + 6))}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        <svg width={width} height={HEADER} className="block">
          {days.map((d, i) => {
            const first = i === 0 || d.endsWith('-01');
            return (
              <g key={d}>
                {isWeekend(d) && <rect x={i * dayW} y={22} width={dayW} height={HEADER - 22} fill="#f2f4f7" />}
                {first && (
                  <text x={i * dayW + 4} y={15} fontSize={12} fontWeight={600} fill="var(--color-ink-2)">
                    {fmtMonth(d)}
                  </text>
                )}
                {first && <line x1={i * dayW} x2={i * dayW} y1={0} y2={HEADER} stroke="var(--color-line)" />}
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
          <rect x={todayX} y={24} width={dayW} height={HEADER - 26} rx={5} fill="none" stroke="var(--color-cobalt)" strokeWidth={1.5} />
          <text x={deadlineX - 4} y={15} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--color-crimson)">
            дедлайн {fmtDate(state.project.deadline)}
          </text>
        </svg>
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
            {(['#b3bccb', '#dc2f45', '#f97316'] as const).map((c) => (
              <marker key={c} id={`arrow-${c.slice(1)}`} viewBox="0 0 8 8" refX={7} refY={4} markerWidth={7} markerHeight={7} orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill={c} />
              </marker>
            ))}
            <pattern id="ghost-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#aeb6c5" strokeWidth="1.5" />
            </pattern>
          </defs>

          {days.map((d, i) => (isWeekend(d) ? <rect key={d} x={i * dayW} y={0} width={dayW} height={height} fill="#f5f6f9" /> : null))}
          {order.map((id, i) => (
            <g key={id}>
              {selectedId === id && <rect x={0} y={i * ROW} width={width} height={ROW} fill="var(--color-cobalt-soft)" opacity={0.6} />}
              <line x1={0} x2={width} y1={(i + 1) * ROW} y2={(i + 1) * ROW} stroke="#eceff4" />
            </g>
          ))}

          <rect x={todayX} y={0} width={dayW} height={height} fill="var(--color-cobalt)" opacity={0.06} />
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
            const color = wave ? '#f97316' : critDeps.has(d.id) ? '#dc2f45' : '#b3bccb';
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
                stroke={color}
                strokeWidth={wave || critDeps.has(d.id) ? 1.8 : 1.3}
                markerEnd={`url(#arrow-${color.slice(1)})`}
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
                return <path key={id} d={`M${g.x2},${cy - 8} l8,8 l-8,8 l-8,-8 z`} fill="none" stroke="#aeb6c5" strokeDasharray="3 2" />;
              }
              return (
                <rect key={id} x={g.x1} y={g.y} width={Math.max(4, g.x2 - g.x1)} height={BAR_H} rx={5} fill="url(#ghost-hatch)" stroke="#aeb6c5" strokeDasharray="4 3" opacity={0.9} />
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
            const fill = shifted ? '#f97316' : FILL[t.status];
            const stroke = selectedId === id ? '#172033' : crit ? '#dc2f45' : shifted ? '#ea580c' : t.status === 'not_started' ? '#aeb6c5' : fill;
            const w = Math.max(4, g.x2 - g.x1);
            const cy = g.y + BAR_H / 2;
            const title = `${t.name}\n${fmtDate(s.startDate)} — ${fmtDate(s.endDate)}${
              t.status !== 'done' ? `\nрезерв ${fmtDays(Math.max(0, s.float))}` : ''
            }`;
            const floatEndX = x(indexToDate(s.lf - 1)) + dayW;

            return (
              <g
                key={`${id}-${imp ? imp.deltaEnd : 0}`}
                className={shifted ? 'wave-in' : undefined}
                style={{ animationDelay: `${delay}ms`, cursor: 'pointer' }}
                onClick={() => select(id)}
              >
                <title>{title}</title>
                {t.status !== 'done' && s.float > 0 && !g.milestone && (
                  <g stroke="#aeb6c5" strokeWidth={1.2}>
                    <line x1={g.x2} x2={floatEndX} y1={cy} y2={cy} strokeDasharray="2 3" />
                    <line x1={floatEndX} x2={floatEndX} y1={cy - 4} y2={cy + 4} />
                  </g>
                )}
                {g.milestone ? (
                  <path d={`M${g.x2},${cy - 9} l9,9 l-9,9 l-9,-9 z`} fill={shifted ? '#f97316' : crit ? '#dc2f45' : '#172033'} stroke={selectedId === id ? '#172033' : 'none'} strokeWidth={2} />
                ) : (
                  <>
                    <rect x={g.x1} y={g.y} width={w} height={BAR_H} rx={5} fill={fill} stroke={stroke} strokeWidth={crit || selectedId === id ? 2 : 1} />
                    {t.status === 'in_progress' && !shifted && todayX > g.x1 && (
                      <rect x={g.x1} y={g.y} width={Math.min(w, todayX - g.x1)} height={BAR_H} rx={5} fill="#1e3bb8" opacity={0.55} />
                    )}
                    {w >= 44 && (
                      <text x={g.x1 + 7} y={cy + 4} fontSize={11} fontWeight={600} fill={t.status === 'not_started' && !shifted ? '#4a5468' : '#fff'}>
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
                      stroke={s.flags.missesDueDate ? '#dc2f45' : '#4a5468'}
                      strokeWidth={1.5}
                    />
                    <path
                      d={`M${x(t.dueDate) + dayW},${g.y - 5} l7,3 l-7,3 z`}
                      fill={s.flags.missesDueDate ? '#dc2f45' : '#4a5468'}
                    />
                  </g>
                )}
                {imp && imp.deltaEnd !== 0 && (
                  <g transform={`translate(${Math.max(g.x2, t.dueDate ? x(t.dueDate) + dayW : 0) + (g.milestone ? 14 : 8)}, ${g.y + 1})`}>
                    <rect width={imp.deltaEnd > 0 ? 50 : 46} height={18} rx={9} fill={imp.deltaEnd > 0 ? '#f97316' : '#2f9e6e'} />
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

      <Legend />
    </div>
  );
}

function Legend() {
  const item = (swatch: ReactNode, label: string) => (
    <span className="flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  );
  const box = (bg: string, border?: string) => (
    <span className="inline-block h-2.5 w-5 rounded-sm" style={{ background: bg, border: border ? `2px solid ${border}` : undefined }} />
  );
  return (
    <div className="sticky left-0 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-4 text-[12px] text-ink-2" style={{ width: 'min(100%, 100vw - 420px)' }}>
      {item(box(FILL.done), 'Выполнена')}
      {item(box(FILL.in_progress), 'В работе')}
      {item(box(FILL.not_started, '#aeb6c5'), 'Не начата')}
      {item(box(FILL.blocked), 'Заблокирована')}
      {item(box('#dfe4ec', '#dc2f45'), 'Критический путь')}
      {item(box('#f97316'), 'Сдвинута изменением')}
      {item(<span className="inline-block w-5 border-t-2 border-dotted border-idle" />, 'Резерв')}
      {item(<span className="inline-block h-3 w-0.5 bg-ink-2" />, 'Срок задачи')}
      {item(<span className="inline-block h-3 w-0.5 bg-cobalt" />, 'Сегодня')}
    </div>
  );
}
