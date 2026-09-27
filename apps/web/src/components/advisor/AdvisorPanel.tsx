import { useMemo } from 'react';
import { Check, Lightbulb, X } from 'lucide-react';
import { advise, type Suggestion } from '@volna/engine';
import { fmtDate, fmtDays, fmtDaysLong } from '../../lib/format';
import { useModel, usePropose } from '../../lib/model';
import { toast, useDraft } from '../../store/draft';
import { Button, Chip, cx } from '../ui';

const COST_LABEL = { 1: 'низкая', 2: 'средняя', 3: 'высокая' } as const;

export function AdvisorPanel() {
  const { state, analysis, today, impact } = useModel();
  const setSide = useDraft((s) => s.setSide);
  const propose = usePropose();
  const advice = useMemo(() => advise(state, today), [state, today]);
  const late = analysis.bufferDays < 0;

  const tryOps = (s: Pick<Suggestion, 'ops'>, message: string) => {
    if (propose(...s.ops)) {
      toast(message, 'success');
      setSide('auto');
    }
  };

  return (
    <section className="p-5">
      <div className="flex items-center gap-2">
        <Lightbulb size={18} className="text-wave" />
        <h2 className="flex-1 text-[15px] font-semibold">Советник по срокам</h2>
        <button type="button" aria-label="Закрыть советника" className="rounded-lg p-1.5 text-ink-3 hover:bg-line-soft hover:text-ink" onClick={() => setSide('auto')}>
          <X size={16} />
        </button>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        {late
          ? `Проект опаздывает на ${fmtDays(-analysis.bufferDays)} (финиш ${fmtDate(analysis.finishDate)}, дедлайн ${fmtDate(state.project.deadline)}). Каждый вариант уже просчитан по текущему плану${impact ? ' с учётом черновика' : ''}. Выбранный вариант попадёт в черновик, и вы увидите последствия до применения.`
          : `Проект укладывается в срок, запас ${fmtDaysLong(analysis.bufferDays)}. Ниже — как усилить запас и снять перегрузки людей.`}
      </p>

      {advice.plan && (
        <div className="mt-4 rounded-xl border-2 border-ink p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[14px] font-semibold">План восстановления</h3>
            <Chip tone={advice.plan.fitsDeadline ? 'moss' : 'wave'}>
              {advice.plan.fitsDeadline
                ? `укладываемся, запас ${fmtDays(advice.plan.bufferAfter)}`
                : `не хватает ${fmtDays(-advice.plan.bufferAfter)}`}
            </Chip>
          </div>
          <ol className="mt-3 space-y-2">
            {advice.plan.steps.map((st, i) => (
              <li key={st.id} className="flex gap-2.5 text-[13px]">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
                  {i + 1}
                </span>
                <span>
                  {st.title}
                  <span className="text-ink-3">, {fmtDays(-st.gainDays)}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[13px] text-ink-2">Финиш после плана: {fmtDate(advice.plan.finishAfter)}</p>
          <Button variant="primary" className="mt-3 w-full" onClick={() => tryOps(advice.plan!, 'План добавлен в черновик — проверьте последствия')}>
            <Check size={15} /> Попробовать план
          </Button>
        </div>
      )}

      <h3 className="mt-6 text-[13px] font-semibold text-ink-2">
        {advice.suggestions.length > 0 ? 'Все варианты' : 'Вариантов нет'}
      </h3>
      {advice.suggestions.length === 0 && (
        <p className="mt-1 text-[13px] text-ink-3">
          {late
            ? 'Ускорить критический путь нечем: все задачи на нём короткие или уже в работе.'
            : 'Сейчас ничего менять не нужно.'}
        </p>
      )}
      <ul className="mt-2 space-y-2">
        {advice.suggestions.map((s) => (
          <li key={s.id} className="rounded-xl border border-line p-3">
            <p className="text-[13px] font-medium leading-snug">{s.title}</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{s.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {s.gainDays > 0 && <Chip tone="moss">финиш {fmtDays(-s.gainDays)}</Chip>}
              {late && (
                <Chip tone={s.fitsDeadline ? 'moss' : 'neutral'}>
                  {s.fitsDeadline ? 'укладываемся в дедлайн' : `ещё не хватает ${fmtDays(-s.bufferAfter)}`}
                </Chip>
              )}
              {s.resolves.length > 0 && s.kind === 'reassign' && <Chip tone="cobalt">снимает перегрузку</Chip>}
              <span className={cx('text-[12px]', s.cost === 3 ? 'text-crimson' : 'text-ink-3')}>
                цена: {COST_LABEL[s.cost]}
              </span>
              <Button size="sm" className="ml-auto" onClick={() => tryOps(s, 'Вариант добавлен в черновик')}>
                Попробовать
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
