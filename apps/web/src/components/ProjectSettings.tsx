import { useState } from 'react';
import { X } from 'lucide-react';
import type { ProjectPatch } from '@volna/engine';
import { useModel, usePropose } from '../lib/model';
import { useDraft } from '../store/draft';
import { Field, inputClass } from './ui';

/** Параметры проекта. Сроки меняются через черновик — последствия видны до применения. */
export function ProjectSettings() {
  const { state } = useModel();
  const propose = usePropose();
  const setSide = useDraft((s) => s.setSide);
  const [name, setName] = useState(state.project.name);
  const patch = (p: ProjectPatch) => propose({ type: 'updateProject', patch: p });

  return (
    <section className="p-5">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-[15px] font-semibold">Параметры проекта</h2>
        <button type="button" aria-label="Закрыть" className="rounded-lg p-1.5 text-ink-3 hover:bg-line-soft hover:text-ink" onClick={() => setSide('auto')}>
          <X size={16} />
        </button>
      </div>
      <div className="mt-4 space-y-3">
        <Field label="Название">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => (name.trim() ? name !== state.project.name && patch({ name: name.trim() }) : setName(state.project.name))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Старт">
            <input type="date" className={inputClass} value={state.project.startDate} onChange={(e) => e.target.value && patch({ startDate: e.target.value })} />
          </Field>
          <Field label="Дедлайн" hint="Изменение дедлайна сразу покажет, хватает ли запаса">
            <input type="date" className={inputClass} value={state.project.deadline} onChange={(e) => e.target.value && patch({ deadline: e.target.value })} />
          </Field>
        </div>
        <Field label="Описание">
          <textarea
            className={inputClass + ' h-24 resize-none py-2'}
            value={state.project.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </Field>
      </div>
      <p className="mt-4 rounded-lg bg-paper px-3 py-2.5 text-[12px] leading-relaxed text-ink-2">
        Изменения попадают в черновик, как и правки задач. Сохраните их кнопкой «Применить изменения».
      </p>
    </section>
  );
}
