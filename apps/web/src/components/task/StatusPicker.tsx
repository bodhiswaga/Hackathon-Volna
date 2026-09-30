import { ChevronDown } from 'lucide-react';
import { statusPatch, TASK_STATUSES, type Task } from '@volna/engine';
import { STATUS_LABEL } from '../../lib/format';
import { useModel, usePropose } from '../../lib/model';
import { cx, Popover, StatusBadge, StatusIcon } from '../ui';

/**
 * Статус задачи пилюлей; клик открывает выбор из четырёх статусов.
 * Смена статуса — обычная правка черновика: фактические даты ставит statusPatch.
 */
export function StatusPicker({
  task,
  size = 'md',
  iconOnly,
  align = 'start',
}: {
  task: Task;
  size?: 'sm' | 'md';
  iconOnly?: boolean;
  align?: 'start' | 'end';
}) {
  const { analysis } = useModel();
  const propose = usePropose();
  return (
    <Popover
      label={`Статус: ${STATUS_LABEL[task.status]}. Изменить`}
      align={align}
      buttonClassName="group flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
      button={
        <span className="relative inline-flex items-center">
          <StatusBadge
            status={task.status}
            size={size}
            iconOnly={iconOnly}
            className={cx(
              'transition-[filter] duration-150 group-hover:brightness-[0.97] group-active:brightness-95',
              !iconOnly && (size === 'sm' ? 'pr-5' : 'pr-6'),
            )}
          />
          {!iconOnly && (
            <ChevronDown
              size={size === 'sm' ? 12 : 14}
              className="pointer-events-none absolute right-1.5 opacity-60"
            />
          )}
        </span>
      }
      panelClassName="w-48"
    >
      {(close) => (
        <div role="menu" aria-label="Статус задачи">
          {TASK_STATUSES.map((st) => (
            <button
              key={st}
              type="button"
              role="menuitemradio"
              aria-checked={task.status === st}
              onClick={() => {
                close();
                if (st !== task.status) {
                  propose({
                    type: 'updateTask',
                    taskId: task.id,
                    patch: statusPatch(task, st, analysis),
                  });
                }
              }}
              className={cx(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-sunken active:bg-pressed',
                task.status === st && 'bg-sunken font-medium',
              )}
            >
              <StatusIcon status={st} />
              {STATUS_LABEL[st]}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
