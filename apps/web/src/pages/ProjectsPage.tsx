import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { addWorkdays } from '@volna/engine';
import { useCreateProject, useDeleteProject, useProjects, useResetDemo } from '../api/hooks';
import { navigate } from '../lib/router';
import { Button, Empty, Field, inputClass, WaveMark } from '../components/ui';
import { fmtDate, fmtDays, HEALTH_COLOR, HEALTH_TEXT, todayISO } from '../lib/format';

export function ProjectsPage() {
  const { data, isLoading, error } = useProjects();
  const create = useCreateProject();
  const remove = useDeleteProject();
  const resetDemo = useResetDemo();
  const today = todayISO();
  const [form, setForm] = useState({
    name: '',
    description: '',
    startDate: today,
    deadline: addWorkdays(today, 30),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(form, { onSuccess: (s) => navigate(`/p/${s.project.id}`) });
  };

  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-6xl items-center gap-3 px-6 pt-6">
        <WaveMark />
        <span className="font-display text-lg font-bold tracking-tight">Волна</span>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-6 pb-16 pt-12 lg:grid-cols-[1fr_360px]">
        <section>
          <h1 className="max-w-2xl font-display text-[34px] font-bold leading-[1.15] tracking-tight">
            Если сейчас что-то изменится, что произойдёт с проектом?
          </h1>
          <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-ink-2">
            Волна пересчитывает план при каждом изменении: показывает, какие задачи сдвинутся, успеет ли
            проект к дедлайну и какие решения помогут вернуть сроки.
          </p>

          <div className="mt-10 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Проекты</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                data?.some((p) => p.project.id === 'demo')
                  ? navigate('/p/demo')
                  : resetDemo.mutate(undefined, { onSuccess: () => navigate('/p/demo') })
              }
            >
              Открыть демо-проект
            </Button>
          </div>

          <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface">
            {isLoading && <p className="p-6 text-sm text-ink-3">Загружаем проекты…</p>}
            {error && <p className="p-6 text-sm text-crimson">{error.message}</p>}
            {data && data.length === 0 && (
              <Empty title="Проектов пока нет">Создайте первый проект справа или откройте демо.</Empty>
            )}
            {data?.map((item, i) => (
              <div
                key={item.project.id}
                className={
                  'group flex cursor-pointer items-center gap-5 px-5 py-4 hover:bg-paper/60 ' +
                  (i > 0 ? 'border-t border-line-soft' : '')
                }
                onClick={() => navigate(`/p/${item.project.id}`)}
              >
                <span
                  className="h-10 w-1.5 shrink-0 rounded-full"
                  style={{ background: HEALTH_COLOR[item.health] }}
                  title={HEALTH_TEXT[item.health]}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.project.name}</p>
                  <p className="mt-0.5 text-sm text-ink-2">
                    {HEALTH_TEXT[item.health]}
                    {item.stats.total > 0 &&
                      `, ${item.bufferDays >= 0 ? `запас ${fmtDays(item.bufferDays)}` : `опоздание ${fmtDays(-item.bufferDays)}`}`}
                  </p>
                </div>
                <div className="hidden text-right text-sm sm:block">
                  <p className="text-ink-3">Финиш / дедлайн</p>
                  <p className="font-medium">
                    {fmtDate(item.finishDate)} / {fmtDate(item.project.deadline)}
                  </p>
                </div>
                <div className="hidden w-28 sm:block">
                  <p className="text-right text-sm text-ink-3">{item.stats.done} из {item.stats.total} задач</p>
                  <div className="mt-1.5 h-1.5 rounded-full bg-line-soft">
                    <div className="h-full rounded-full bg-moss" style={{ width: `${item.stats.progressPct}%` }} />
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Удалить проект"
                  className="rounded-md p-1.5 text-ink-3 opacity-0 hover:bg-crimson-soft hover:text-crimson group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Удалить проект «${item.project.name}»?`)) remove.mutate(item.project.id);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <aside className="lg:pt-2">
          <form onSubmit={submit} className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-lg font-semibold">Новый проект</h2>
            <div className="mt-4 space-y-3">
              <Field label="Название">
                <input
                  className={inputClass}
                  required
                  value={form.name}
                  placeholder="Например, запуск личного кабинета"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Старт">
                  <input
                    type="date"
                    className={inputClass}
                    required
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  />
                </Field>
                <Field label="Дедлайн">
                  <input
                    type="date"
                    className={inputClass}
                    required
                    min={form.startDate}
                    value={form.deadline}
                    onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Описание">
                <textarea
                  className={inputClass + ' h-20 resize-none py-2'}
                  value={form.description}
                  placeholder="Цель и ключевой результат"
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>
            </div>
            <Button type="submit" variant="primary" className="mt-4 w-full" disabled={create.isPending}>
              <Plus size={16} /> Создать проект
            </Button>
          </form>
        </aside>
      </main>
    </div>
  );
}
