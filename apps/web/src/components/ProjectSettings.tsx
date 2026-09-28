import { useState } from 'react';
import { X } from 'lucide-react';
import type { ProjectPatch } from '@volna/engine';
import { useModel, usePropose } from '../lib/model';
import { useDraft } from '../store/draft';
import { Field, IconButton, inputClass } from './ui';

/** Параметры проекта. Сроки меняются через черновик — последствия видны до применения. */
export function ProjectSettings() {
  const { state } = useModel();
  const propose = usePropose();
  const setSide = useDraft((s) => s.setSide);
  const [name, setName] = useState(state.project.name);
  const [nameError, setNameError] = useState<string | null>(null);
  // Неверная дата остаётся в поле, пока её не исправят; в черновик уходит только допустимая.
  const [pending, setPending] = useState<{ startDate?: string; deadline?: string }>({});
  const patch = (p: ProjectPatch) => propose({ type: 'updateProject', patch: p });

  const startDate = pending.startDate ?? state.project.startDate;
  const deadline = pending.deadline ?? state.project.deadline;
  const datesError =
    startDate && deadline && deadline < startDate ? 'Дедлайн раньше старта проекта' : null;

  const changeDate = (key: 'startDate' | 'deadline', value: string) => {
    const next = { startDate, deadline, [key]: value };
    if (!next.startDate || !next.deadline || next.deadline < next.startDate) {
      setPending({ ...pending, [key]: value });
      return;
    }
    setPending({});
    patch({ startDate: next.startDate, deadline: next.deadline });
  };

  return (
    <section className="p-5">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-base font-semibold">Параметры проекта</h2>
        <IconButton
          className="in-sheet:hidden"
          label="Закрыть параметры"
          onClick={() => setSide('auto')}
        >
          <X size={16} />
        </IconButton>
      </div>
      <div className="mt-5 space-y-4">
        <Field label="Название" error={nameError}>
          {(a11y) => (
            <input
              className={inputClass}
              value={name}
              {...a11y}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError && e.target.value.trim()) setNameError(null);
              }}
              onBlur={() => {
                if (!name.trim()) return setNameError('Введите название проекта');
                if (name.trim() !== state.project.name) patch({ name: name.trim() });
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Старт" error={!startDate ? 'Укажите дату старта' : null}>
            {(a11y) => (
              <input
                type="date"
                className={inputClass}
                value={startDate}
                {...a11y}
                onChange={(e) => changeDate('startDate', e.target.value)}
              />
            )}
          </Field>
          <Field label="Дедлайн" error={!deadline ? 'Укажите дедлайн' : datesError}>
            {(a11y) => (
              <input
                type="date"
                className={inputClass}
                value={deadline}
                {...a11y}
                onChange={(e) => changeDate('deadline', e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Описание">
          <textarea
            className={inputClass + ' h-24 resize-none py-2'}
            value={state.project.description}
            placeholder="Цель и ключевой результат"
            onChange={(e) => patch({ description: e.target.value })}
          />
        </Field>
      </div>
      <p className="mt-5 text-[13px] leading-relaxed text-ink-3">
        Изменения попадают в черновик, как и правки задач: сдвиг дедлайна сразу покажет, хватает ли
        запаса. План изменится после «Применить».
      </p>
    </section>
  );
}
