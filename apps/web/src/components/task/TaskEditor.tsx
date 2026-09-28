import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Minus, Plus, Trash2, X } from 'lucide-react';
import { addWorkdays, statusPatch, TASK_STATUSES, type Task, type TaskPatch } from '@volna/engine';
import { fmtDate, fmtDays, fmtWeekday, newId, STATUS_COLOR, STATUS_SHORT } from '../../lib/format';
import { GLOSSARY } from '../../lib/glossary';
import { takeNameFocus, useModel, usePropose } from '../../lib/model';
import { toast, useDraft } from '../../store/draft';
import {
  Button,
  Chip,
  cx,
  Field,
  IconButton,
  inputClass,
  SectionTitle,
  StatusDot,
  Term,
  Tooltip,
} from '../ui';

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
  const [delayDate, setDelayDate] = useState(addWorkdays(analysis.today, 5));
  const [name, setName] = useState(task.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // Только что созданная задача: название выделено, можно сразу печатать своё.
  useEffect(() => {
    if (takeNameFocus(task.id)) nameRef.current?.select();
  }, [task.id]);
  const setTab = useDraft((s) => s.setTab);
  const openEvent = useDraft((s) => s.openEvent);
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
        return 'ограничение «не раньше»';
      case 'projectStart':
        return 'старт проекта';
      case 'actual':
        return 'фактические даты';
    }
  })();

  return (
    <section className="p-5">
      <div className="flex items-start gap-2">
        <span className="mt-3">
          <StatusDot status={task.status} size={10} />
        </span>
        <div className="min-w-0 flex-1">
          <input
            ref={nameRef}
            className={cx(
              'w-full min-w-0 rounded-lg border px-2 py-1 text-[17px] leading-7 font-semibold outline-none transition-colors duration-150 hover:border-line focus:border-cobalt',
              nameError ? 'border-crimson' : 'border-transparent',
            )}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError && e.target.value.trim()) setNameError(null);
            }}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label="Название задачи"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'task-name-error' : undefined}
          />
          {nameError && (
            <p
              id="task-name-error"
              role="alert"
              className="animate-fade-in mt-1 px-2 text-[12px] text-crimson"
            >
              {nameError}
            </p>
          )}
        </div>
        <IconButton className="in-sheet:hidden" label="Закрыть задачу" onClick={() => select(null)}>
          <X size={16} />
        </IconButton>
      </div>

      {s && (
        <div className="mt-1.5 flex flex-wrap gap-1.5 pl-[18px]">
          {s.flags.critical && (
            <Tooltip content={GLOSSARY.critical}>
              <span tabIndex={0} className="rounded-md">
                <Chip tone="crimson">Критический путь</Chip>
              </span>
            </Tooltip>
          )}
          {s.flags.missesDueDate && <Chip tone="crimson">Не успевает к сроку</Chip>}
          {s.flags.overdue && <Chip tone="crimson">Просрочена</Chip>}
          {s.flags.pastDeadline && <Chip tone="crimson">За дедлайном</Chip>}
          {s.flags.lowFloat && <Chip tone="wave">Мало резерва</Chip>}
          {s.flags.overloaded && <Chip tone="wave">Исполнитель перегружен</Chip>}
          {s.flags.blockedByPredecessor && <Chip tone="ochre">Предшественник не завершён</Chip>}
        </div>
      )}

      <div
        className="mt-4 grid grid-cols-4 gap-0.5 rounded-lg bg-sunken p-0.5"
        role="radiogroup"
        aria-label="Статус задачи"
      >
        {TASK_STATUSES.map((st) => (
          <button
            key={st}
            type="button"
            role="radio"
            aria-checked={task.status === st}
            onClick={() => patch(statusPatch(task, st, analysis))}
            className={cx(
              'flex h-8 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium transition-colors duration-150',
              task.status === st
                ? 'bg-surface text-ink shadow-raised'
                : 'text-ink-3 hover:bg-pressed/60 hover:text-ink active:bg-pressed',
            )}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[st] }} />
            {STATUS_SHORT[st]}
          </button>
        ))}
      </div>

      {s && (
        <dl className="mt-4 grid grid-cols-3 gap-3 rounded-lg border border-line px-3.5 py-3 text-[13px]">
          <div>
            <dt className="text-ink-3">Начало</dt>
            <dd className="font-medium">
              {fmtDate(s.startDate)} <span className="text-ink-3">{fmtWeekday(s.startDate)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">Окончание</dt>
            <dd className="font-medium">
              {fmtDate(s.endDate)} <span className="text-ink-3">{fmtWeekday(s.endDate)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">
              <Term hint={GLOSSARY.float}>Резерв</Term>
            </dt>
            <dd className={cx('font-medium', s.flags.critical && 'text-crimson')}>
              {task.status === 'done' ? '—' : s.flags.critical ? 'нет' : fmtDays(s.float)}
            </dd>
          </div>
          <p className="col-span-3 border-t border-line-soft pt-2.5 text-[12px] text-ink-2">
            Старт: {driverText}
          </p>
        </dl>
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
      </div>

      <Section title="Зависит от">
        <DepList
          items={preds.map((d) => ({ dep: d, other: byId.get(d.predecessorId)! }))}
          candidates={candidates}
          onAdd={(id) => addDep(id, task.id)}
          addLabel="Добавить предшественника"
          showLag
        />
      </Section>
      <Section title="Блокирует">
        <DepList
          items={succs.map((d) => ({ dep: d, other: byId.get(d.successorId)! }))}
          candidates={candidates}
          onAdd={(id) => addDep(task.id, id)}
          addLabel="Добавить последующую задачу"
        />
      </Section>

      <Section title="Сроки">
        <div className="grid grid-cols-2 gap-x-3 gap-y-4">
          <Field label={<Term hint={GLOSSARY.dueDate}>Срок выполнения</Term>}>
            <DateInput
              label="срок выполнения"
              value={task.dueDate}
              onChange={(v) => patch({ dueDate: v })}
            />
          </Field>
          <Field label="Начать не раньше">
            <DateInput
              label="начать не раньше"
              value={task.startNotEarlier}
              onChange={(v) => patch({ startNotEarlier: v })}
            />
          </Field>
          {(task.status === 'in_progress' || task.status === 'done') && (
            <Field label="Фактический старт">
              <DateInput
                label="фактический старт"
                value={task.actualStart}
                onChange={(v) => patch({ actualStart: v })}
              />
            </Field>
          )}
          {task.status === 'done' && (
            <Field label="Фактическое окончание">
              <DateInput
                label="фактическое окончание"
                value={task.actualEnd}
                onChange={(v) => patch({ actualEnd: v })}
              />
            </Field>
          )}
        </div>
      </Section>

      {task.status !== 'done' && (
        <Section title="Что если…">
          <div className="divide-y divide-line-soft rounded-lg border border-line px-3.5 text-[13px]">
            <Scenario label="Задача оказалась сложнее">
              {[2, 5, 10].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  onClick={() => patch({ durationDays: task.durationDays + n })}
                >
                  +{n} дн.
                </Button>
              ))}
            </Scenario>
            <Scenario label="Смежник или подрядчик задерживает старт">
              <span className="text-ink-2">до</span>
              <input
                type="date"
                aria-label="Дата, раньше которой задача не начнётся"
                className={inputClass + ' h-8 w-[150px] text-[13px]'}
                value={delayDate}
                onChange={(e) => setDelayDate(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!delayDate}
                onClick={() => patch({ startNotEarlier: delayDate })}
              >
                Задать
              </Button>
            </Scenario>
            {task.assigneeId && (
              <Scenario label="Исполнитель уходит в отпуск или болеет">
                <Button
                  size="sm"
                  onClick={() => openEvent({ kind: 'absence', personId: task.assigneeId! })}
                >
                  Указать даты
                </Button>
              </Scenario>
            )}
            <Scenario label="Ответственный недоступен">
              <select
                aria-label="Кому передать задачу"
                className={inputClass + ' h-8 w-[220px] text-[13px]'}
                value=""
                onChange={(e) => e.target.value && patch({ assigneeId: e.target.value })}
              >
                <option value="">Передать задачу…</option>
                {state.people
                  .filter((p) => p.id !== task.assigneeId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Scenario>
            {task.status !== 'blocked' && (
              <Scenario label="Работа встала">
                <Button size="sm" onClick={() => patch(statusPatch(task, 'blocked', analysis))}>
                  Заблокировать
                </Button>
              </Scenario>
            )}
          </div>
        </Section>
      )}

      <Section title="Описание">
        <textarea
          aria-label="Описание задачи"
          placeholder="Что входит в задачу, критерии готовности"
          className={inputClass + ' h-20 resize-none py-2'}
          value={task.description}
          onChange={(e) => patch({ description: e.target.value })}
        />
      </Section>

      <Button variant="danger" size="sm" className="mt-5 -ml-2.5" onClick={remove}>
        <Trash2 size={14} /> Удалить задачу
      </Button>
    </section>
  );
}

function Scenario({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-3">
      <p className="mb-2 font-medium">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
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
          <StatusDot status={other.status} size={7} />
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
