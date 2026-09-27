import { useState, type ReactNode } from 'react';
import { Minus, Plus, Trash2, X } from 'lucide-react';
import {
  addWorkdays,
  statusPatch,
  TASK_STATUSES,
  type Task,
  type TaskPatch,
} from '@volna/engine';
import { fmtDate, fmtDays, fmtWeekday, newId, STATUS_COLOR, STATUS_SHORT } from '../../lib/format';
import { useModel, usePropose } from '../../lib/model';
import { useDraft } from '../../store/draft';
import { Button, Chip, cx, Field, inputClass } from '../ui';

function DateInput({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="flex gap-1">
      <input type="date" className={inputClass} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
      {value && (
        <button type="button" aria-label="Очистить" className="rounded-lg px-2 text-ink-3 hover:bg-line-soft hover:text-ink" onClick={() => onChange(null)}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="mb-2 text-[13px] font-semibold text-ink-2">{title}</h3>
      {children}
    </div>
  );
}

export function TaskEditor({ task }: { task: Task }) {
  const { state, analysis } = useModel();
  const propose = usePropose();
  const select = useDraft((s) => s.select);
  const [delayDate, setDelayDate] = useState(addWorkdays(analysis.today, 5));
  const [name, setName] = useState(task.name);
  const setTab = useDraft((s) => s.setTab);
  const s = analysis.tasks[task.id];
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const patch = (p: TaskPatch) => propose({ type: 'updateTask', taskId: task.id, patch: p });

  const preds = state.dependencies.filter((d) => d.successorId === task.id);
  const succs = state.dependencies.filter((d) => d.predecessorId === task.id);
  const linked = new Set([task.id, ...preds.map((d) => d.predecessorId), ...succs.map((d) => d.successorId)]);
  const candidates = state.tasks.filter((t) => !linked.has(t.id));

  const addDep = (predecessorId: string, successorId: string) =>
    propose({
      type: 'addDependency',
      dependency: { id: newId(), projectId: state.project.id, predecessorId, successorId, lagDays: 0 },
    });

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
        <input
          className="min-w-0 flex-1 rounded-lg border border-transparent px-1 py-0.5 text-[17px] font-semibold outline-none hover:border-line focus:border-cobalt"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => (name.trim() ? name.trim() !== task.name && patch({ name: name.trim() }) : setName(task.name))}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-label="Название задачи"
        />
        <button type="button" aria-label="Закрыть" className="rounded-lg p-1.5 text-ink-3 hover:bg-line-soft hover:text-ink" onClick={() => select(null)}>
          <X size={16} />
        </button>
      </div>

      {s && (
        <div className="mt-2 flex flex-wrap gap-1.5 px-1">
          {s.flags.critical && <Chip tone="crimson">Критический путь</Chip>}
          {s.flags.missesDueDate && <Chip tone="crimson">Не успевает к сроку</Chip>}
          {s.flags.overdue && <Chip tone="crimson">Просрочена</Chip>}
          {s.flags.pastDeadline && <Chip tone="crimson">За дедлайном</Chip>}
          {s.flags.lowFloat && <Chip tone="wave">Мало резерва</Chip>}
          {s.flags.overloaded && <Chip tone="wave">Исполнитель перегружен</Chip>}
          {s.flags.blockedByPredecessor && <Chip tone="ochre">Предшественник не завершён</Chip>}
        </div>
      )}

      <div className="mt-4 grid grid-cols-4 gap-1 rounded-xl bg-paper p-1">
        {TASK_STATUSES.map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => patch(statusPatch(task, st, analysis))}
            className={cx(
              'flex h-8 items-center justify-center gap-1.5 rounded-lg text-[12px] font-medium transition-colors',
              task.status === st ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink',
            )}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[st] }} />
            {STATUS_SHORT[st]}
          </button>
        ))}
      </div>

      {s && (
        <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl border border-line p-3 text-[13px]">
          <div>
            <p className="text-ink-3">Начало</p>
            <p className="font-medium">
              {fmtDate(s.startDate)} <span className="text-ink-3">{fmtWeekday(s.startDate)}</span>
            </p>
          </div>
          <div>
            <p className="text-ink-3">Окончание</p>
            <p className="font-medium">
              {fmtDate(s.endDate)} <span className="text-ink-3">{fmtWeekday(s.endDate)}</span>
            </p>
          </div>
          <div>
            <p className="text-ink-3">Резерв</p>
            <p className={cx('font-medium', s.flags.critical && 'text-crimson')}>
              {task.status === 'done' ? '—' : s.flags.critical ? 'нет' : fmtDays(s.float)}
            </p>
          </div>
          <p className="col-span-3 text-[12px] text-ink-2">Старт: {driverText}</p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Длительность, раб. дней">
          <div className="flex">
            <button type="button" aria-label="Меньше" className="h-9 rounded-l-lg border border-line px-2.5 hover:bg-paper" onClick={() => patch({ durationDays: Math.max(0, task.durationDays - 1) })}>
              <Minus size={14} />
            </button>
            <input
              type="number"
              min={0}
              className="h-9 w-full border-y border-line text-center text-sm outline-none focus:border-cobalt"
              value={task.durationDays}
              onChange={(e) => patch({ durationDays: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
            />
            <button type="button" aria-label="Больше" className="h-9 rounded-r-lg border border-line px-2.5 hover:bg-paper" onClick={() => patch({ durationDays: task.durationDays + 1 })}>
              <Plus size={14} />
            </button>
          </div>
        </Field>
        <Field
          label="Ответственный"
          hint={
            state.people.length === 0 && (
              <button type="button" className="text-cobalt hover:underline" onClick={() => setTab('team')}>
                Добавьте людей во вкладке «Команда»
              </button>
            )
          }
        >
          <select className={inputClass} value={task.assigneeId ?? ''} onChange={(e) => patch({ assigneeId: e.target.value || null })}>
            <option value="">Не назначен</option>
            {state.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Срок выполнения">
          <DateInput value={task.dueDate} onChange={(v) => patch({ dueDate: v })} />
        </Field>
        <Field label="Начать не раньше">
          <DateInput value={task.startNotEarlier} onChange={(v) => patch({ startNotEarlier: v })} />
        </Field>
        {(task.status === 'in_progress' || task.status === 'done') && (
          <Field label="Фактический старт">
            <DateInput value={task.actualStart} onChange={(v) => patch({ actualStart: v })} />
          </Field>
        )}
        {task.status === 'done' && (
          <Field label="Фактическое окончание">
            <DateInput value={task.actualEnd} onChange={(v) => patch({ actualEnd: v })} />
          </Field>
        )}
      </div>

      {task.status !== 'done' && (
        <Section title="Что если…">
          <div className="divide-y divide-wave/15 rounded-xl bg-wave-soft/70 px-3 text-[13px]">
            <Scenario label="Задача оказалась сложнее">
              {[2, 5, 10].map((n) => (
                <Button key={n} size="sm" onClick={() => patch({ durationDays: task.durationDays + n })}>
                  +{n} дн.
                </Button>
              ))}
            </Scenario>
            <Scenario label="Смежник или подрядчик задерживает старт">
              <span className="text-ink-2">до</span>
              <input type="date" className={inputClass + ' h-7 w-[140px] text-[13px]'} value={delayDate} onChange={(e) => setDelayDate(e.target.value)} />
              <Button size="sm" onClick={() => patch({ startNotEarlier: delayDate })}>
                Задать
              </Button>
            </Scenario>
            <Scenario label="Ответственный недоступен">
              <select
                className={inputClass + ' h-7 w-[220px] text-[13px]'}
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

      <div className="mt-5">
        <Field label="Описание">
          <textarea
            className={inputClass + ' h-20 resize-none py-2'}
            value={task.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </Field>
      </div>

      <Button
        variant="danger"
        size="sm"
        className="mt-4"
        onClick={() => {
          if (propose({ type: 'deleteTask', taskId: task.id })) select(null);
        }}
      >
        <Trash2 size={14} /> Удалить задачу
      </Button>
    </section>
  );
}

function Scenario({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-2.5">
      <p className="mb-1.5 font-medium">{label}</p>
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
  return (
    <div className="space-y-1.5">
      {items.length === 0 && <p className="text-[13px] text-ink-3">Нет связей</p>}
      {items.map(({ dep, other }) => (
        <div key={dep.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[13px]">
          <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => select(other.id)}>
            {other.name}
          </button>
          {showLag && (
            <label
              className="flex items-center gap-1 text-[12px] text-ink-3"
              title="Пауза в рабочих днях после окончания предшественника. Отрицательное значение — нахлёст: старт до окончания"
            >
              {dep.lagDays < 0 ? 'нахлёст' : 'пауза'}
              <input
                type="number"
                min={-other.durationDays}
                className="h-6 w-11 rounded border border-line text-center text-[12px] text-ink outline-none focus:border-cobalt"
                value={dep.lagDays}
                onChange={(e) =>
                  propose({ type: 'updateDependency', dependencyId: dep.id, lagDays: Math.round(Number(e.target.value) || 0) })
                }
              />
            </label>
          )}
          <button
            type="button"
            aria-label="Убрать связь"
            className="rounded p-0.5 text-ink-3 hover:bg-crimson-soft hover:text-crimson"
            onClick={() => propose({ type: 'removeDependency', dependencyId: dep.id })}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      {candidates.length > 0 && (
        <select className={inputClass + ' h-8 text-[13px] text-ink-2'} value="" onChange={(e) => e.target.value && onAdd(e.target.value)}>
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
