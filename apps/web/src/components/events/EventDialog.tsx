import { useMemo, useState, type ReactNode } from 'react';
import {
  CalendarClock,
  FilePlus2,
  Flag,
  Hourglass,
  TreePalm,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  addWorkdays,
  analyze,
  applyChangeSet,
  compileEvent,
  describeOps,
  forecast,
  type ProjectEvent,
  type ProjectEventKind,
  type ProjectState,
} from '@volna/engine';
import { chanceText, fmtBuffer, fmtChance, fmtDate, fmtDays, newId } from '../../lib/format';
import { useModel, useProposeAction } from '../../lib/model';
import { toast, useDraft, type EventRequest } from '../../store/draft';
import { Button, cx, Dialog, Field, inputClass, MenuItem, Popover, Segmented } from '../ui';

const EVENT_KINDS: { kind: ProjectEventKind; icon: LucideIcon; title: string; hint: string }[] = [
  {
    kind: 'absence',
    icon: TreePalm,
    title: 'Сотрудник уходит в отпуск или болеет',
    hint: 'Задачи встанут на паузу или перейдут к коллеге',
  },
  {
    kind: 'harder',
    icon: Hourglass,
    title: 'Задача оказалась сложнее',
    hint: 'Добавить дни к оценке',
  },
  {
    kind: 'delay',
    icon: CalendarClock,
    title: 'Подрядчик задерживает старт',
    hint: 'Работа начнётся не раньше даты',
  },
  {
    kind: 'scope',
    icon: FilePlus2,
    title: 'Заказчик добавил требование',
    hint: 'Новая работа встраивается в цепочку',
  },
  {
    kind: 'deadline',
    icon: Flag,
    title: 'Заказчик переносит дедлайн',
    hint: 'Новая дата сдачи проекта',
  },
];

/** Задачи, которые ещё можно сделать длиннее. */
const openTasks = (state: ProjectState) =>
  state.tasks.filter((t) => t.status !== 'done' && t.durationDays > 0);
/** Задачи, у которых ещё можно сдвинуть старт. */
const waitingTasks = (state: ProjectState) =>
  state.tasks.filter((t) => t.status === 'not_started' || t.status === 'blocked');
/** Значение поля «рабочих дней»: целое, не меньше одного. */
const toDays = (raw: string) => Math.max(1, Math.round(Number(raw) || 1));

/** Кнопка «Что случилось?» в верхней панели. */
export function EventsMenu() {
  const openEvent = useDraft((s) => s.openEvent);
  return (
    <Popover
      label="Что случилось? Смоделировать событие"
      align="end"
      buttonClassName="flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface text-[13px] font-medium whitespace-nowrap text-ink transition-colors duration-150 hover:border-line-strong hover:bg-sunken active:bg-pressed aria-expanded:bg-sunken md:w-auto md:px-3"
      iconOnly
      button={
        <>
          <Zap size={15} className="text-ink-2" />
          <span className="hidden md:inline">Что случилось?</span>
        </>
      }
      panelClassName="w-[340px] max-w-[calc(100vw-16px)]"
    >
      {(close) => (
        <>
          <p className="px-3 pt-2 pb-1.5 text-[12px] leading-snug text-ink-3">
            Опишите событие — система сама поправит план и покажет последствия до применения
          </p>
          {EVENT_KINDS.map((e) => (
            <MenuItem
              key={e.kind}
              icon={<e.icon size={16} />}
              hint={e.hint}
              onClick={() => {
                close();
                openEvent({ kind: e.kind });
              }}
            >
              {e.title}
            </MenuItem>
          ))}
        </>
      )}
    </Popover>
  );
}

/** Окно события: монтируется, пока в сторе есть запрос. */
export function EventHost() {
  const request = useDraft((s) => s.event);
  if (!request) return null;
  return (
    <EventDialog
      key={`${request.kind}:${request.personId ?? ''}:${request.taskId ?? ''}`}
      request={request}
    />
  );
}

function initialEvent(
  req: EventRequest,
  state: ProjectState,
  today: string,
  es: (id: string) => string,
) {
  const open = openTasks(state);
  const waiting = waitingTasks(state);
  const firstPerson = req.personId ?? state.people[0]?.id ?? '';
  switch (req.kind) {
    case 'absence':
      return {
        kind: 'absence',
        personId: firstPerson,
        from: today,
        to: addWorkdays(today, 4),
        handoverTo: null,
      } satisfies ProjectEvent;
    case 'harder':
      return {
        kind: 'harder',
        taskId: req.taskId ?? open[0]?.id ?? '',
        extraDays: 5,
      } satisfies ProjectEvent;
    case 'delay': {
      const taskId = req.taskId ?? waiting[0]?.id ?? '';
      return {
        kind: 'delay',
        taskId,
        until: taskId ? addWorkdays(es(taskId), 5) : today,
      } satisfies ProjectEvent;
    }
    case 'scope':
      return {
        kind: 'scope',
        name: '',
        durationDays: 3,
        afterTaskId: null,
        beforeTaskId: null,
        assigneeId: null,
      } satisfies ProjectEvent;
    case 'deadline':
      return {
        kind: 'deadline',
        deadline: addWorkdays(state.project.deadline, 5),
      } satisfies ProjectEvent;
  }
}

function EventDialog({ request }: { request: EventRequest }) {
  const { state, analysis, forecast: currentForecast, today } = useModel();
  const openEvent = useDraft((s) => s.openEvent);
  const proposeAction = useProposeAction();
  const [event, setEvent] = useState<ProjectEvent>(() =>
    initialEvent(request, state, today, (id) => analysis.tasks[id]?.startDate ?? today),
  );
  const meta = EVENT_KINDS.find((k) => k.kind === event.kind)!;
  const close = () => openEvent(null);

  // Черновик ничего не знает о событии, пока его не подтвердили: считаем превью сами.
  const preview = useMemo(() => {
    const knownAlerts = new Set(analysis.alerts.map((x) => x.key));
    if (event.kind === 'scope' && !event.name.trim()) {
      return {
        compiled: null,
        error: null,
        result: null,
        hint: 'Опишите новую работу — последствия появятся здесь.',
      };
    }
    if (fieldError(event, state.project.startDate)) {
      return {
        compiled: null,
        error: null,
        result: null,
        hint: 'Исправьте поле выше — последствия появятся здесь.',
      };
    }
    try {
      const compiled = compileEvent(state, today, event, newId);
      if (compiled.ops.length === 0) {
        return {
          compiled,
          error: null,
          result: null,
          hint: 'Событие не затрагивает незавершённые задачи — план не изменится.',
        };
      }
      const next = applyChangeSet(state, compiled.ops);
      const a = analyze(next, today);
      return {
        compiled,
        error: null,
        result: {
          lines: describeOps(state, compiled.ops),
          finishDelta: a.finishIndex - analysis.finishIndex,
          finish: a.finishDate,
          buffer: a.bufferDays,
          chance: forecast(next, today, { runs: 800 }).chance,
          // Срыв дедлайна уже сказан строкой выше — показываем только новые проблемы задач и людей.
          problems: a.alerts
            .filter(
              (x) =>
                !knownAlerts.has(x.key) && x.code !== 'deadline_missed' && x.code !== 'low_buffer',
            )
            .map((x) => x.text),
        },
        hint: null,
      };
    } catch (e) {
      return {
        compiled: null,
        error: e instanceof Error ? e.message : 'Событие не подходит к плану',
        result: null,
        hint: null,
      };
    }
  }, [state, analysis, today, event]);

  const submit = () => {
    if (!preview.compiled || preview.compiled.ops.length === 0) return;
    const { ops, title } = preview.compiled;
    if (proposeAction(ops, { action: title, reason: title })) {
      toast('Событие в черновике — план ещё не изменён', 'success');
      close();
    }
  };

  return (
    <Dialog onClose={close} labelledBy="event-title" width="max-w-lg">
      <form
        className="p-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sunken text-ink-2">
            <meta.icon size={18} />
          </span>
          <h2 id="event-title" className="text-lg font-semibold">
            {meta.title}
          </h2>
        </div>

        <div className="mt-5 space-y-3.5">
          <EventFields event={event} onChange={setEvent} />
        </div>

        <div
          className={cx(
            'mt-5 rounded-lg border px-4 py-3 text-[13px] leading-relaxed',
            preview.error
              ? 'border-crimson/30 bg-crimson-soft text-crimson'
              : 'border-line bg-paper text-ink-2',
          )}
          aria-live="polite"
        >
          {preview.error ? (
            preview.error
          ) : !preview.result ? (
            preview.hint
          ) : (
            <>
              <p className="font-medium text-ink">
                {preview.result.finishDelta > 0
                  ? `Финиш сдвинется на ${fmtDays(preview.result.finishDelta, true)}: ${fmtDate(analysis.finishDate)} → ${fmtDate(preview.result.finish)}`
                  : preview.result.finishDelta < 0
                    ? `Финиш станет раньше: ${fmtDate(preview.result.finish)}`
                    : 'Финиш проекта не изменится'}
              </p>
              <p className="mt-0.5">
                До дедлайна: {fmtBuffer(analysis.bufferDays)} →{' '}
                <span className={cx(preview.result.buffer < 0 && 'text-crimson')}>
                  {fmtBuffer(preview.result.buffer)}
                </span>
                , шанс успеть {fmtChance(currentForecast.chance)} →{' '}
                <span className={chanceText(preview.result.chance)}>
                  {fmtChance(preview.result.chance)}
                </span>
              </p>
              {preview.result.problems.slice(0, 2).map((t) => (
                <p key={t} className="mt-0.5 text-crimson">
                  {t}
                </p>
              ))}
              <ul className="mt-2 space-y-0.5 text-[12px] text-ink-3">
                {preview.result.lines.slice(0, 4).map((l, i) => (
                  <li key={i}>• {l}</li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            Отмена
          </Button>
          <Button variant="primary" type="submit" disabled={!preview.result}>
            Показать последствия
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Ошибка конкретного поля: показывается под ним, а превью ждёт исправления. */
function fieldError(
  event: ProjectEvent,
  projectStart: string,
): { field: string; text: string } | null {
  switch (event.kind) {
    case 'absence':
      if (!event.from) return { field: 'from', text: 'Укажите первый день' };
      if (!event.to) return { field: 'to', text: 'Укажите последний день' };
      if (event.to < event.from) return { field: 'to', text: 'Последний день раньше первого' };
      return null;
    case 'delay':
      return event.until ? null : { field: 'until', text: 'Укажите дату' };
    case 'deadline':
      if (!event.deadline) return { field: 'deadline', text: 'Укажите дату' };
      if (event.deadline < projectStart)
        return { field: 'deadline', text: 'Дедлайн раньше старта проекта' };
      return null;
    default:
      return null;
  }
}

function EventFields({
  event,
  onChange,
}: {
  event: ProjectEvent;
  onChange: (e: ProjectEvent) => void;
}) {
  const { state, analysis } = useModel();
  const open = openTasks(state);
  const waiting = waitingTasks(state);
  const invalid = fieldError(event, state.project.startDate);
  const err = (field: string) => (invalid?.field === field ? invalid.text : null);

  switch (event.kind) {
    case 'absence': {
      const set = (p: Partial<typeof event>) => onChange({ ...event, ...p });
      return (
        <>
          <Field label="Кто отсутствует">
            <Select
              value={event.personId}
              onChange={(v) =>
                set({
                  personId: v,
                  // Режим «передать» сохраняем, но не себе самому.
                  handoverTo:
                    event.handoverTo === null || event.handoverTo !== v
                      ? event.handoverTo
                      : (state.people.find((p) => p.id !== v)?.id ?? null),
                })
              }
            >
              {state.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.role}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="С" error={err('from')}>
              {(a11y) => (
                <input
                  type="date"
                  className={inputClass}
                  value={event.from}
                  onChange={(e) => set({ from: e.target.value })}
                  {...a11y}
                />
              )}
            </Field>
            <Field label="По (включительно)" error={err('to')}>
              {(a11y) => (
                <input
                  type="date"
                  className={inputClass}
                  value={event.to}
                  onChange={(e) => set({ to: e.target.value })}
                  {...a11y}
                />
              )}
            </Field>
          </div>
          <Field label="Что с задачами">
            <Segmented
              label="Что с задачами"
              value={event.handoverTo === null ? 'pause' : 'handover'}
              onChange={(v) =>
                set({
                  handoverTo:
                    v === 'pause'
                      ? null
                      : (state.people.find((p) => p.id !== event.personId)?.id ?? null),
                })
              }
              options={[
                { id: 'pause', label: 'Ждут возвращения' },
                { id: 'handover', label: 'Передать коллеге' },
              ]}
            />
          </Field>
          {event.handoverTo !== null && (
            <Field label="Кому передать">
              <Select value={event.handoverTo} onChange={(v) => set({ handoverTo: v })}>
                {state.people
                  .filter((p) => p.id !== event.personId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.role}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
        </>
      );
    }
    case 'harder':
      return (
        <>
          <Field label="Какая задача">
            <Select value={event.taskId} onChange={(v) => onChange({ ...event, taskId: v })}>
              {open.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({fmtDays(t.durationDays)})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="На сколько рабочих дней дольше">
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                max={200}
                className={inputClass + ' no-spin w-24'}
                value={event.extraDays}
                onChange={(e) => onChange({ ...event, extraDays: toDays(e.target.value) })}
                data-autofocus
              />
              {[2, 5, 10].map((n) => (
                <Button
                  key={n}
                  variant={event.extraDays === n ? 'primary' : 'secondary'}
                  onClick={() => onChange({ ...event, extraDays: n })}
                >
                  +{n}
                </Button>
              ))}
            </div>
          </Field>
        </>
      );
    case 'delay':
      return (
        <>
          <Field
            label="Чья работа задерживается"
            hint={waiting.length === 0 ? 'Все задачи уже начаты' : undefined}
          >
            <Select
              value={event.taskId}
              onChange={(v) =>
                onChange({
                  ...event,
                  taskId: v,
                  until: addWorkdays(analysis.tasks[v].startDate, 5),
                })
              }
            >
              {waiting.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} —{' '}
                  {state.people.find((p) => p.id === t.assigneeId)?.name ?? 'без ответственного'}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Начнётся не раньше"
            error={err('until')}
            hint={
              event.taskId
                ? `По плану старт ${fmtDate(analysis.tasks[event.taskId].startDate)}`
                : undefined
            }
          >
            {(a11y) => (
              <input
                type="date"
                className={inputClass}
                value={event.until}
                onChange={(e) => onChange({ ...event, until: e.target.value })}
                {...a11y}
              />
            )}
          </Field>
        </>
      );
    case 'scope':
      return (
        <>
          <Field label="Что нужно сделать">
            <input
              className={inputClass}
              placeholder="Например, «Вход через Госуслуги»"
              value={event.name}
              onChange={(e) => onChange({ ...event, name: e.target.value })}
              data-autofocus
              required
            />
          </Field>
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <Field label="Рабочих дней">
              <input
                type="number"
                min={1}
                max={200}
                className={inputClass}
                value={event.durationDays}
                onChange={(e) => onChange({ ...event, durationDays: toDays(e.target.value) })}
              />
            </Field>
            <Field label="Кто делает">
              <Select
                value={event.assigneeId ?? ''}
                onChange={(v) => onChange({ ...event, assigneeId: v || null })}
              >
                <option value="">Пока не назначен</option>
                {state.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="После задачи">
              <Select
                value={event.afterTaskId ?? ''}
                onChange={(v) => onChange({ ...event, afterTaskId: v || null })}
              >
                <option value="">Можно начать сразу</option>
                {state.tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Перед задачей">
              <Select
                value={event.beforeTaskId ?? ''}
                onChange={(v) => onChange({ ...event, beforeTaskId: v || null })}
              >
                <option value="">Ничего не блокирует</option>
                {state.tasks
                  .filter((t) => t.status !== 'done')
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
        </>
      );
    case 'deadline': {
      const current = state.project.deadline;
      return (
        <Field label="Новый дедлайн" hint={`Сейчас ${fmtDate(current)}`} error={err('deadline')}>
          {(a11y) => (
            <div className="flex gap-2">
              <input
                type="date"
                className={inputClass}
                value={event.deadline}
                onChange={(e) => onChange({ ...event, deadline: e.target.value })}
                {...a11y}
              />
              {[
                { label: '−1 нед.', n: -5 },
                { label: '+1 нед.', n: 5 },
                { label: '+2 нед.', n: 10 },
              ].map((o) => (
                <Button
                  key={o.n}
                  className="shrink-0"
                  onClick={() => onChange({ ...event, deadline: addWorkdays(current, o.n) })}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          )}
        </Field>
      );
    }
  }
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  );
}
