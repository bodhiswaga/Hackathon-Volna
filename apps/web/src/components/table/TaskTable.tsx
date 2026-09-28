import { statusPatch, TASK_STATUSES, type TaskPatch } from '@volna/engine';
import { fmtDate, fmtDays, STATUS_LABEL } from '../../lib/format';
import { useModel, usePropose } from '../../lib/model';
import { useDraft } from '../../store/draft';
import { Chip, cx, Empty, StatusDot } from '../ui';

const cell = 'border-b border-line-soft px-3 py-2 align-middle';
const control =
  'h-8 rounded-lg border border-transparent bg-transparent px-1.5 text-[13px] outline-none transition-colors hover:border-line focus:border-cobalt';

export function TaskTable() {
  const { state, analysis: a, impact } = useModel();
  const propose = usePropose();
  const selectedId = useDraft((s) => s.selectedTaskId);
  const select = useDraft((s) => s.select);
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const affected = new Map((impact?.affected ?? []).map((x) => [x.taskId, x]));

  if (state.tasks.length === 0) {
    return <Empty title="Задач пока нет">Нажмите «Задача» вверху справа, чтобы добавить первую.</Empty>;
  }

  const patch = (taskId: string, p: TaskPatch) => propose({ type: 'updateTask', taskId, patch: p });

  return (
    <div className="p-5">
      <table className="w-full border-separate border-spacing-0 overflow-clip rounded-2xl border border-line bg-surface text-[13px]">
        <thead>
          <tr className="text-left text-[12px] text-ink-3">
            {['Задача', 'Ответственный', 'Статус', 'Длительность', 'Начало', 'Окончание', 'Срок', 'Резерв', 'Риски'].map((h) => (
              <th key={h} className="glass sticky top-0 z-10 border-b border-line px-3 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {a.order.map((id) => {
            const t = byId.get(id)!;
            const s = a.tasks[id];
            const imp = affected.get(id);
            const preds = state.dependencies.filter((d) => d.successorId === id).map((d) => byId.get(d.predecessorId)?.name);
            return (
              <tr
                key={id}
                className={cx(
                  'transition-colors',
                  selectedId === id ? 'bg-cobalt-soft' : imp ? 'bg-wave-soft' : 'hover:bg-paper/70',
                )}
              >
                <td className={cell + ' max-w-[280px]'}>
                  <button type="button" onClick={() => select(id)} className="flex max-w-full items-start gap-2 text-left">
                    <span className="mt-[5px]"><StatusDot status={t.status} /></span>
                    <span className="min-w-0">
                    <span className="block truncate font-medium hover:underline">{t.name}</span>
                    {preds.length > 0 && <span className="block truncate text-[12px] text-ink-3">после: {preds.join(', ')}</span>}
                    </span>
                  </button>
                </td>
                <td className={cell}>
                  <select className={control + ' max-w-[160px]'} value={t.assigneeId ?? ''} onChange={(e) => patch(id, { assigneeId: e.target.value || null })}>
                    <option value="">Не назначен</option>
                    {state.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={cell}>
                  <select className={control} value={t.status} onChange={(e) => patch(id, statusPatch(t, e.target.value as (typeof TASK_STATUSES)[number], a))}>
                    {TASK_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {STATUS_LABEL[st]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={cell}>
                  <input
                    type="number"
                    min={0}
                    className={control + ' w-16 text-right'}
                    value={t.durationDays}
                    onChange={(e) => patch(id, { durationDays: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                    aria-label="Длительность в рабочих днях"
                  />
                </td>
                <td className={cell + ' whitespace-nowrap'}>{fmtDate(s.startDate)}</td>
                <td className={cell + ' whitespace-nowrap'}>
                  {fmtDate(s.endDate)}
                  {imp && imp.deltaEnd !== 0 && (
                    <span className={cx('ml-1.5 text-[12px] font-semibold', imp.deltaEnd > 0 ? 'text-wave' : 'text-moss')}>
                      {fmtDays(imp.deltaEnd, true)}
                    </span>
                  )}
                </td>
                <td className={cx(cell, 'whitespace-nowrap', s.flags.missesDueDate && 'font-medium text-crimson')}>{fmtDate(t.dueDate)}</td>
                <td className={cx(cell, 'whitespace-nowrap', s.flags.critical && 'font-medium text-crimson')}>
                  {t.status === 'done' ? '—' : s.flags.critical ? 'нет' : fmtDays(s.float)}
                </td>
                <td className={cell}>
                  <div className="flex flex-wrap gap-1">
                    {s.flags.critical && <Chip tone="crimson">крит. путь</Chip>}
                    {s.flags.missesDueDate && <Chip tone="crimson">срыв срока</Chip>}
                    {s.flags.overdue && <Chip tone="crimson">просрочена</Chip>}
                    {s.flags.blocked && <Chip tone="ochre">блок</Chip>}
                    {s.flags.overloaded && <Chip tone="wave">перегруз</Chip>}
                    {s.flags.lowFloat && <Chip tone="wave">мало резерва</Chip>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
