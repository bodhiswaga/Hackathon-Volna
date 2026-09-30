import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { usePeopleMutations } from '../api/hooks';
import { fmtRange, fmtTasks } from '../lib/format';
import { useModel } from '../lib/model';
import { confirmAction, useDraft } from '../store/draft';
import { Avatar, Button, Chip, cx, IconButton, inputClass, StatusIcon } from './ui';

/** Enter в поле человека — сохранить (как везде в интерфейсе). */
const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') e.currentTarget.blur();
};

export function TeamView() {
  const { state, analysis: a } = useModel();
  const { add, update, remove } = usePeopleMutations(state.project.id);
  const select = useDraft((s) => s.select);
  const [form, setForm] = useState({ name: '', role: '' });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(form, { onSuccess: () => setForm({ name: '', role: '' }) });
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h2 className="font-display text-xl font-semibold">Команда и загрузка</h2>
      <p className="mt-1 text-sm text-ink-2">
        Незавершённые задачи каждого человека по датам. Если задачи одного человека пересекаются, он
        перегружен.
      </p>

      <div className="mt-6 space-y-3">
        {state.people.map((p) => {
          const tasks = a.order
            .map((id) => state.tasks.find((t) => t.id === id)!)
            .filter((t) => t.assigneeId === p.id && t.status !== 'done');
          const overloaded = tasks.some((t) => a.tasks[t.id].flags.overloaded);
          return (
            <div
              key={p.id}
              className={cx(
                'group rounded-2xl border bg-surface p-4 transition-colors',
                overloaded ? 'border-wave/40' : 'border-line',
              )}
            >
              <div className="flex items-center gap-3">
                <Avatar person={p} size={36} />
                <div className="min-w-0 flex-1">
                  <input
                    className="w-full rounded-md border border-transparent px-1 font-medium outline-none transition-colors hover:border-line focus:border-cobalt"
                    defaultValue={p.name}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      // Пустое имя не сохраняем — возвращаем прежнее, чтобы поле не врало.
                      if (!name) e.target.value = p.name;
                      else if (name !== p.name) update.mutate({ personId: p.id, name });
                    }}
                    onKeyDown={blurOnEnter}
                    aria-label="Имя"
                  />
                  <input
                    className="w-full rounded-md border border-transparent px-1 text-[13px] text-ink-2 outline-none transition-colors hover:border-line focus:border-cobalt"
                    defaultValue={p.role}
                    placeholder="Роль"
                    onBlur={(e) =>
                      e.target.value !== p.role &&
                      update.mutate({ personId: p.id, role: e.target.value })
                    }
                    onKeyDown={blurOnEnter}
                    aria-label="Роль"
                  />
                </div>
                {overloaded && <Chip tone="wave">перегружен</Chip>}
                <span className="text-[13px] whitespace-nowrap text-ink-3">
                  {tasks.length > 0 ? `${fmtTasks(tasks.length)} впереди` : 'задач нет'}
                </span>
                <IconButton
                  label={`Удалить ${p.name}`}
                  className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-crimson-soft hover:text-crimson"
                  onClick={async () => {
                    const ok = await confirmAction({
                      title: `Удалить ${p.name} из команды?`,
                      text: 'Задачи этого человека останутся в плане без ответственного.',
                      confirmLabel: 'Удалить',
                      danger: true,
                    });
                    if (ok) remove.mutate(p.id);
                  }}
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>
              {tasks.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5 pl-[48px]">
                  {tasks.map((t) => {
                    const s = a.tasks[t.id];
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => select(t.id)}
                          className={cx(
                            'flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-left text-[12px] transition-colors hover:border-ink-3',
                            s.flags.overloaded ? 'border-wave/50 bg-wave-soft' : 'border-line',
                          )}
                        >
                          <StatusIcon status={t.status} size={13} />
                          <span className="font-medium">{t.name}</span>
                          <span className="text-ink-3">{fmtRange(s.startDate, s.endDate)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <form
        onSubmit={submit}
        className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-line p-4"
      >
        <input
          className={inputClass + ' max-w-[240px]'}
          required
          placeholder="Имя"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          aria-label="Имя нового участника"
        />
        <input
          className={inputClass + ' max-w-[240px]'}
          placeholder="Роль, например QA"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
          aria-label="Роль нового участника"
        />
        <Button type="submit" variant="primary" disabled={add.isPending}>
          <UserPlus size={15} /> Добавить в команду
        </Button>
      </form>
    </div>
  );
}
