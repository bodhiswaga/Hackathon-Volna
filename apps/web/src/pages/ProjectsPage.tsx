import { useState, type FormEvent } from 'react';
import { FolderPlus, Plus, Sparkles, Trash2 } from 'lucide-react';
import { addWorkdays, type Health } from '@volna/engine';
import type { ProjectListItem } from '../api/client';
import { useCreateProject, useDeleteProject, useProjects, useResetDemo } from '../api/hooks';
import { navigate } from '../lib/router';
import { Button, Chip, Dialog, Empty, Field, IconButton, inputClass, SeaLine, Skeleton, WaveMark } from '../components/ui';
import { fmtDate, HEALTH_COLOR, HEALTH_TEXT, todayISO } from '../lib/format';
import { confirmAction } from '../store/draft';

const HEALTH_TONE: Record<Health, 'moss' | 'wave' | 'crimson'> = {
  ok: 'moss',
  attention: 'wave',
  intervention: 'crimson',
};

export function ProjectsPage() {
  const { data, isLoading, error } = useProjects();
  const resetDemo = useResetDemo();
  const [creating, setCreating] = useState(false);
  const hasDemo = data?.some((p) => p.project.id === 'demo') ?? false;

  const openDemo = () => resetDemo.mutate(undefined, { onSuccess: () => navigate('/p/demo') });

  return (
    <div className="min-h-full pb-20">
      <header className="mx-auto flex max-w-5xl items-center gap-2.5 px-6 pt-6">
        <WaveMark />
        <span className="font-display text-lg font-semibold">Волна</span>
      </header>

      <section className="mx-auto max-w-5xl px-6 pt-16">
        <h1 className="max-w-3xl font-display text-[40px] leading-[1.08] font-semibold sm:text-[46px]">
          Если сейчас что-то изменится, что произойдёт с проектом?
        </h1>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-2">
          Волна пересчитывает план при каждом изменении: показывает, какие задачи сдвинутся, успеет ли проект к
          дедлайну и какие решения помогут вернуть сроки.
        </p>
      </section>

      <SeaLine amplitude={0.38} color="var(--color-ink-3)" duration={26} className="relative mt-10 h-12 w-full" />

      <main className="mx-auto max-w-5xl px-6 pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">
            Проекты{data && data.length > 0 && <span className="ml-2 text-ink-3">{data.length}</span>}
          </h2>
          <div className="flex gap-2">
            {data && !hasDemo && (
              <Button onClick={openDemo} disabled={resetDemo.isPending}>
                <Sparkles size={15} /> Открыть демо
              </Button>
            )}
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> Новый проект
            </Button>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-3xl border border-line bg-surface shadow-[0_1px_2px_rgb(18_29_51/0.04)]">
          {isLoading && (
            <div className="space-y-3 p-5">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          )}
          {error && <p className="p-6 text-sm text-crimson">{error.message}</p>}
          {data && data.length === 0 && (
            <Empty
              icon={<FolderPlus size={20} />}
              title="Проектов пока нет"
              action={
                <div className="flex gap-2">
                  <Button onClick={openDemo} disabled={resetDemo.isPending}>
                    <Sparkles size={15} /> Открыть демо
                  </Button>
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    <Plus size={16} /> Новый проект
                  </Button>
                </div>
              }
            >
              Создайте свой проект или откройте демо: там уже есть задачи, связи и команда.
            </Empty>
          )}
          {data?.map((item, i) => <ProjectRow key={item.project.id} item={item} first={i === 0} />)}
        </div>
      </main>

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function ProjectRow({ item, first }: { item: ProjectListItem; first: boolean }) {
  const remove = useDeleteProject();
  const empty = item.stats.total === 0;
  const late = item.bufferDays < 0;
  return (
    <div className={'group relative flex items-center ' + (first ? '' : 'border-t border-line-soft')}>
      <span
        className="absolute top-4 bottom-4 left-0 w-[3px] rounded-r-full"
        style={{ background: empty ? 'var(--color-idle)' : HEALTH_COLOR[item.health] }}
      />
      <a
        href={`#/p/${encodeURIComponent(item.project.id)}`}
        className="flex min-w-0 flex-1 items-center gap-6 py-4 pr-2 pl-6 transition-colors hover:bg-paper/60"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{item.project.name}</p>
          <p className="mt-0.5 truncate text-[13px] text-ink-3">
            {item.project.description || `${fmtDate(item.project.startDate)} — ${fmtDate(item.project.deadline)}`}
          </p>
        </div>
        <div className="hidden w-44 md:block">
          {empty ? (
            <Chip>План пуст</Chip>
          ) : (
            <Chip tone={HEALTH_TONE[item.health]}>{HEALTH_TEXT[item.health]}</Chip>
          )}
        </div>
        <dl className="hidden w-40 text-[13px] sm:block">
          <div className="flex justify-between gap-2">
            <dt className="text-ink-3">Финиш</dt>
            <dd className={late ? 'font-medium text-crimson' : 'font-medium'}>{fmtDate(item.finishDate)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink-3">Дедлайн</dt>
            <dd className="font-medium">{fmtDate(item.project.deadline)}</dd>
          </div>
        </dl>
        <div className="hidden w-28 lg:block">
          <p className="text-right text-[13px] text-ink-3">
            {item.stats.done} из {item.stats.total}
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line-soft">
            <div className="h-full rounded-full bg-moss" style={{ width: `${item.stats.progressPct}%` }} />
          </div>
        </div>
      </a>
      <IconButton
        label="Удалить проект"
        className="mr-3 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-crimson-soft hover:text-crimson"
        onClick={async () => {
          const ok = await confirmAction({
            title: `Удалить проект «${item.project.name}»?`,
            text: 'Задачи, команда и журнал изменений будут удалены без возможности восстановления.',
            confirmLabel: 'Удалить проект',
            danger: true,
          });
          if (ok) remove.mutate(item.project.id);
        }}
      >
        <Trash2 size={16} />
      </IconButton>
    </div>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateProject();
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
    <Dialog onClose={onClose} labelledBy="new-project-title">
      <form onSubmit={submit} className="p-6">
        <h2 id="new-project-title" className="font-display text-xl font-semibold">
          Новый проект
        </h2>
        <p className="mt-1 text-sm text-ink-2">Задачи и команду добавите на следующем шаге.</p>
        <div className="mt-5 space-y-4">
          <Field label="Название">
            <input
              className={inputClass}
              required
              data-autofocus
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
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            Создать проект
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
