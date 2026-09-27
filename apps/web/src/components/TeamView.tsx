import { useState, type FormEvent } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { usePeopleMutations } from '../api/hooks';
import { fmtDate } from '../lib/format';
import { useModel } from '../lib/model';
import { useDraft } from '../store/draft';
import { Avatar, Button, Chip, inputClass } from './ui';

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
    <div className="mx-auto max-w-4xl p-6">
      <h2 className="text-lg font-semibold">Команда и загрузка</h2>
      <p className="mt-1 text-sm text-ink-2">
        Незавершённые задачи каждого человека по датам. Если задачи одного человека пересекаются, он перегружен.
      </p>

      <div className="mt-5 space-y-3">
        {state.people.map((p) => {
          const tasks = a.order
            .map((id) => state.tasks.find((t) => t.id === id)!)
            .filter((t) => t.assigneeId === p.id && t.status !== 'done');
          const overloaded = tasks.some((t) => a.tasks[t.id].flags.overloaded);
          return (
            <div key={p.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center gap-3">
                <Avatar person={p} size={34} />
                <div className="min-w-0 flex-1">
                  <input
                    className="w-full rounded border border-transparent px-1 font-medium outline-none hover:border-line focus:border-cobalt"
                    defaultValue={p.name}
                    onBlur={(e) => e.target.value.trim() && e.target.value !== p.name && update.mutate({ personId: p.id, name: e.target.value.trim() })}
                    aria-label="Имя"
                  />
                  <input
                    className="w-full rounded border border-transparent px-1 text-[13px] text-ink-2 outline-none hover:border-line focus:border-cobalt"
                    defaultValue={p.role}
                    placeholder="Роль"
                    onBlur={(e) => e.target.value !== p.role && update.mutate({ personId: p.id, role: e.target.value })}
                    aria-label="Роль"
                  />
                </div>
                {overloaded && <Chip tone="wave">перегружен</Chip>}
                <span className="text-[13px] text-ink-3">{tasks.length} в плане</span>
                <button
                  type="button"
                  aria-label={`Удалить ${p.name}`}
                  className="rounded-md p-1.5 text-ink-3 hover:bg-crimson-soft hover:text-crimson"
                  onClick={() => {
                    if (confirm(`Удалить ${p.name}? Его задачи останутся без ответственного.`)) remove.mutate(p.id);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              {tasks.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5 pl-[46px]">
                  {tasks.map((t) => {
                    const s = a.tasks[t.id];
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => select(t.id)}
                          className={
                            'rounded-lg border px-2 py-1 text-left text-[12px] hover:border-ink-3 ' +
                            (s.flags.overloaded ? 'border-wave bg-wave-soft' : 'border-line')
                          }
                        >
                          <span className="font-medium">{t.name}</span>
                          <span className="ml-1.5 text-ink-3">
                            {fmtDate(s.startDate)} — {fmtDate(s.endDate)}
                          </span>
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

      <form onSubmit={submit} className="mt-5 flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-line p-4">
        <input className={inputClass + ' max-w-[240px]'} required placeholder="Имя" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={inputClass + ' max-w-[240px]'} placeholder="Роль, например QA" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
        <Button type="submit" variant="primary" disabled={add.isPending}>
          <UserPlus size={15} /> Добавить в команду
        </Button>
      </form>
    </div>
  );
}
