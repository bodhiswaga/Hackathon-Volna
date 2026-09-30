import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronRight, Minus, Plus, Trash2, X } from 'lucide-react';
import { type Task, type TaskPatch } from '@volna/engine';
import { fmtDate, fmtDays, fmtDaysLong, fmtRange, newId } from '../../lib/format';
import { GLOSSARY } from '../../lib/glossary';
import { takeNameFocus, useModel, usePropose } from '../../lib/model';
import { toast, useDraft } from '../../store/draft';
import { TaskEventsMenu } from '../events/EventDialog';
import {
  Button,
  Chip,
  cx,
  Field,
  IconButton,
  inputClass,
  SectionTitle,
  StatusIcon,
  Term,
  Tooltip,
} from '../ui';
import { StatusPicker } from './StatusPicker';

function DateInput({
  value,
  onChange,
  label,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
}) {
  return (
    <div className="flex gap-1">
      <input
        type="date"
        className={inputClass}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
      {value && (
        <IconButton label={`Очистить: ${label}`} className="h-9 w-9" onClick={() => onChange(null)}>
          <X size={14} />
        </IconButton>
      )}
    </div>
  );
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-6 border-t border-line-soft pt-5">
      <SectionTitle>{title}</SectionTitle>
      {children}
    </div>
  );
}

/** Вернуть черновик к состоянию до действия — для «Отменить» в тосте. */
function undoTo(ops: ReturnType<typeof useDraft.getState>['ops'], after?: () => void) {
  return {
    label: 'Отменить',
    onClick: () => {
      useDraft.getState().setOps(ops);
      after?.();
    },
  };
}

export function TaskEditor({ task }: { task: Task }) {
  const { state, analysis } = useModel();
  const propose = usePropose();
  const select = useDraft((s) => s.select);
  const [name, setName] = useState(task.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLTextAreaElement>(null);
  // Только что созданная задача: название выделено, можно сразу печатать своё.
  useEffect(() => {
    if (takeNameFocus(task.id)) nameRef.current?.select();
  }, [task.id]);
  // Название поменялось снаружи (Ctrl+Z, «Отменить» в тосте) — показываем актуальное,
  // если человек сейчас не печатает в поле.
  useEffect(() => {
    if (document.activeElement !== nameRef.current) setName(task.name);
  }, [task.name]);
  const setTab = useDraft((s) => s.setTab);
  const s = analysis.tasks[task.id];
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const patch = (p: TaskPatch) => propose({ type: 'updateTask', taskId: task.id, patch: p });

  const preds = state.dependencies.filter((d) => d.successorId === task.id);
  const succs = state.dependencies.filter((d) => d.predecessorId === task.id);
  const linked = new Set([
    task.id,
    ...preds.map((d) => d.predecessorId),
    ...succs.map((d) => d.successorId),
  ]);
  const candidates = state.tasks.filter((t) => !linked.has(t.id));
  // Проблемы задачи одной строкой — теми же словами, что в «На что обратить внимание».
  const alerts = analysis.alerts
    .filter((x) => x.taskIds.includes(task.id))
    .sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'high' ? -1 : 1));
  // «Дополнительно» раскрыт сразу, если там уже что-то задано.
  const hasExtra = Boolean(task.startNotEarlier || task.description);

  const addDep = (predecessorId: string, successorId: string) =>
    propose({
      type: 'addDependency',
      dependency: {
        id: newId(),
        projectId: state.project.id,
        predecessorId,
        successorId,
        lagDays: 0,
      },
    });

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Введите название задачи');
      return;
    }
    setNameError(null);
    if (trimmed !== task.name) patch({ name: trimmed });
  };

  const remove = () => {
    const before = useDraft.getState().ops;
    if (!propose({ type: 'deleteTask', taskId: task.id })) return;
    select(null);
    toast(`Задача «${task.name}» удалена`, 'info', {
      action: undoTo(before, () => select(task.id)),
    });
  };

  const driverText = (() => {
    if (!s) return '';
    switch (s.driver.kind) {
      case 'dependency':
        return `ждёт окончания «${byId.get(s.driver.taskId)?.name}»${s.driver.lagDays ? ` + ${fmtDays(s.driver.lagDays)}` : ''}`;
      case 'today':
        return 'может начаться не раньше сегодняшнего дня';
      case 'constraint':
        return `ограничение «начать не раньше ${fmtDate(task.startNotEarlier)}»`;
      case 'projectStart':
        return 'старт проекта';
      case 'actual':
        return task.status === 'done'
          ? `выполнена ${fmtDate(task.actualEnd)}, даты фактические`
          : `в работе с ${fmtDate(task.actualStart)}`;
    }
  })();

  return (
    <section className="p-5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {/* Многострочное: длинное название видно целиком и на телефоне. Enter — сохранить. */}
          <textarea
            ref={nameRef}
            rows={1}
            className={cx(
              '-ml-2 block w-[calc(100%+8px)] min-w-0 resize-none rounded-lg border px-2 py-1 text-[17px] leading-7 font-semibold outline-none [field-sizing:content] transition-colors duration-150 hover:border-line focus:border-cobalt',
              nameError ? 'border-crimson' : 'border-transparent',
            )}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError && e.target.value.trim()) setNameError(null);
            }}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            aria-label="Название задачи"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'task-name-error' : undefined}
          />
          {nameError && (
            <p
              id="task-name-error"
              role="alert"
              className="animate-fade-in mt-1 text-[12px] text-crimson"
            >
              {nameError}
            </p>
          )}
        </div>
        <IconButton className="in-sheet:hidden" label="Закрыть задачу" onClick={() => select(null)}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusPicker task={task} />
        {s?.flags.critical && (
          <Tooltip content={GLOSSARY.critical}>
            <span tabIndex={0} className="rounded-md">
              <Chip tone="crimson">Критический путь</Chip>
            </span>
          </Tooltip>
        )}
      </div>

      {s && (
        <div className="mt-4 rounded-lg border border-line px-3.5 py-3 text-[13px]">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[15px] font-semibold">
              {fmtRange(s.startDate, s.endDate, ' → ')}
            </span>
            <span className="text-ink-3">
              {task.durationDays > 0 ? fmtDaysLong(task.durationDays) : 'веха'}
              {task.status !== 'done' && (
                <>
                  {' · '}
                  <Term hint={GLOSSARY.float}>резерв</Term>{' '}
                  <span className={cx(s.flags.critical && 'font-medium text-crimson')}>
                    {s.flags.critical ? 'нет' : fmtDays(s.float)}
                  </span>
                </>
              )}
            </span>
          </p>
          <p className="mt-1 text-[12px] text-ink-2">Старт: {driverText}</p>
          {alerts.length > 0 && (
            <div
              className={cx(
                'mt-2.5 flex items-start gap-2 rounded-md px-2.5 py-2 text-[13px] leading-snug',
                alerts[0]!.severity === 'high'
                  ? 'bg-crimson-soft text-crimson'
                  : 'bg-wave-soft text-wave-deep',
              )}
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                {alerts[0]!.text}
                {alerts.length > 1 && (
                  <span className="text-ink-2"> · и ещё {alerts.length - 1}</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-4">
        <Field label="Длительность, раб. дней">
          <div className="flex">
            <button
              type="button"
              aria-label="Меньше"
              disabled={task.durationDays <= 0}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-l-lg border border-line text-ink-2 transition-colors duration-150 hover:bg-sunken active:bg-pressed disabled:opacity-45"
              onClick={() => patch({ durationDays: Math.max(0, task.durationDays - 1) })}
            >
              <Minus size={14} />
            </button>
            <input
              type="number"
              min={0}
              className="no-spin h-9 w-full min-w-0 border-y border-line text-center text-sm outline-none focus:border-cobalt"
              value={task.durationDays}
              onChange={(e) =>
                patch({ durationDays: Math.max(0, Math.round(Number(e.target.value) || 0)) })
              }
            />
            <button
              type="button"
              aria-label="Больше"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-r-lg border border-line text-ink-2 transition-colors duration-150 hover:bg-sunken active:bg-pressed"
              onClick={() => patch({ durationDays: task.durationDays + 1 })}
            >
              <Plus size={14} />
            </button>
          </div>
        </Field>
        <Field
          label="Ответственный"
          hint={
            state.people.length === 0 && (
              <button
                type="button"
                className="rounded-sm text-cobalt hover:underline"
                onClick={() => setTab('team')}
              >
                Добавьте людей во вкладке «Команда»
              </button>
            )
          }
        >
          <select
            className={inputClass}
            value={task.assigneeId ?? ''}
            onChange={(e) => patch({ assigneeId: e.target.value || null })}
          >
            <option value="">Не назначен</option>
            {state.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="col-span-2">
          <Field
            label={<Term hint={GLOSSARY.dueDate}>Сдать до</Term>}
            hint={
              task.dueDate && s && task.status !== 'done'
                ? s.flags.missesDueDate
                  ? `Прогноз окончания ${fmtDate(s.endDate)} — позже срока`
                  : `Прогноз окончания ${fmtDate(s.endDate)} — успевает`
                : 'Необязательно: если задать, Волна предупредит о срыве'
            }
          >
            <DateInput
              label="сдать до"
              value={task.dueDate}
              onChange={(v) => patch({ dueDate: v })}
            />
          </Field>
        </div>
      </div>

      <Section title="Связи">
        <p className="mb-1.5 text-[12px] font-medium text-ink-3">Ждёт окончания</p>
        <DepList
          items={preds.map((d) => ({ dep: d, other: byId.get(d.predecessorId)! }))}
          candidates={candidates}
          onAdd={(id) => addDep(id, task.id)}
          addLabel="Добавить задачу, которую ждёт"
          showLag
        />
        <p className="mt-3.5 mb-1.5 text-[12px] font-medium text-ink-3">Блокирует</p>
        <DepList
          items={succs.map((d) => ({ dep: d, other: byId.get(d.successorId)! }))}
          candidates={candidates}
          onAdd={(id) => addDep(task.id, id)}
          addLabel="Добавить задачу, которая ждёт эту"
        />
      </Section>

      {task.status !== 'done' && (
        <div className="mt-5">
          <TaskEventsMenu task={task} />
        </div>
      )}

      <details
        open={hasExtra || undefined}
        className="group mt-6 border-t border-line-soft pt-4 [&_summary::-webkit-details-marker]:hidden"
      >
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-semibold text-ink select-none hover:text-cobalt outline-none focus-visible:ring-2 focus-visible:ring-cobalt">
          <ChevronRight
            size={15}
            className="text-ink-3 transition-transform duration-150 group-open:rotate-90"
          />
          Дополнительно
          <span className="ml-auto text-[12px] font-normal text-ink-3">старт, описание</span>
        </summary>
        <div className="mt-4 space-y-4">
          <Field
            label={<Term hint={GLOSSARY.startNotEarlier}>Начать не раньше</Term>}
            hint="Например, подрядчик сможет подключиться только с этой даты"
          >
            <DateInput
              label="начать не раньше"
              value={task.startNotEarlier}
              onChange={(v) => patch({ startNotEarlier: v })}
            />
          </Field>
          {(task.status === 'in_progress' || task.status === 'done') && (
            <div className="grid grid-cols-2 gap-x-3">
              <Field label="Фактически начата" hint="Ставится сама при смене статуса">
                <DateInput
                  label="фактический старт"
                  value={task.actualStart}
                  onChange={(v) => patch({ actualStart: v })}
                />
              </Field>
              {task.status === 'done' && (
                <Field label="Фактически закончена">
                  <DateInput
                    label="фактическое окончание"
                    value={task.actualEnd}
                    onChange={(v) => patch({ actualEnd: v })}
                  />
                </Field>
              )}
            </div>
          )}
          <Field label="Описание">
            <textarea
              aria-label="Описание задачи"
              placeholder="Что входит в задачу, критерии готовности"
              className={inputClass + ' h-20 resize-none py-2'}
              value={task.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </Field>
        </div>
      </details>

      <Button variant="danger" size="sm" className="mt-5 -ml-2.5" onClick={remove}>
        <Trash2 size={14} /> Удалить задачу
      </Button>
    </section>
  );
}

function DepList({
  items,
  candidates,
  onAdd,
  addLabel,
  showLag,
}: {
  items: { dep: { id: string; lagDays: number }; other: Task }[];
  candidates: Task[];
  onAdd: (taskId: string) => void;
  addLabel: string;
  showLag?: boolean;
}) {
  const propose = usePropose();
  const select = useDraft((s) => s.select);

  const removeDep = (id: string, name: string) => {
    const before = useDraft.getState().ops;
    if (propose({ type: 'removeDependency', dependencyId: id })) {
      toast(`Связь с «${name}» убрана`, 'info', { action: undoTo(before) });
    }
  };

  return (
    <div className="space-y-1.5">
      {items.length === 0 && <p className="text-[13px] text-ink-3">Связей нет</p>}
      {items.map(({ dep, other }) => (
        <div
          key={dep.id}
          className="flex items-center gap-2 rounded-lg border border-line py-1 pr-1 pl-3 text-[13px]"
        >
          <StatusIcon status={other.status} size={14} />
          <button
            type="button"
            className="min-w-0 flex-1 truncate rounded-sm text-left hover:text-cobalt hover:underline"
            onClick={() => select(other.id)}
          >
            {other.name}
          </button>
          {showLag && (
            <label className="flex items-center gap-1 text-[12px] text-ink-3">
              <Term hint={GLOSSARY.lag}>{dep.lagDays < 0 ? 'нахлёст' : 'пауза'}</Term>
              <input
                type="number"
                min={-other.durationDays}
                aria-label={`Пауза после «${other.name}», раб. дней`}
                className="h-7 w-12 rounded-md border border-line text-center text-[13px] text-ink outline-none transition-colors duration-150 hover:border-line-strong focus:border-cobalt"
                value={dep.lagDays}
                onChange={(e) =>
                  propose({
                    type: 'updateDependency',
                    dependencyId: dep.id,
                    lagDays: Math.round(Number(e.target.value) || 0),
                  })
                }
              />
            </label>
          )}
          <IconButton
            label={`Убрать связь с «${other.name}»`}
            className="h-7 w-7 hover:bg-crimson-soft hover:text-crimson"
            onClick={() => removeDep(dep.id, other.name)}
          >
            <X size={14} />
          </IconButton>
        </div>
      ))}
      {candidates.length > 0 && (
        <select
          aria-label={addLabel}
          className={inputClass + ' h-8 text-[13px] text-ink-2'}
          value=""
          onChange={(e) => e.target.value && onAdd(e.target.value)}
        >
          <option value="">{addLabel}…</option>
          {candidates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
