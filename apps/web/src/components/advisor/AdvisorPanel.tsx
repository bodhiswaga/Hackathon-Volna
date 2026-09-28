import { useMemo } from 'react';
import { Check, Lightbulb, X } from 'lucide-react';
import { advise, type Suggestion } from '@volna/engine';
import { fmtDate, fmtDays, fmtDaysLong } from '../../lib/format';
import { useModel, usePropose } from '../../lib/model';
import { toast, useDraft } from '../../store/draft';
import { Button, Chip, cx, IconButton, SectionTitle } from '../ui';

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
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-wave-soft text-wave-deep">
          <Lightbulb size={17} />
        </span>
        <h2 className="flex-1 font-display text-[16px] font-semibold">Советник по срокам</h2>
        <IconButton label="Закрыть советника" onClick={() => setSide('auto')}>
          <X size={16} />
        </IconButton>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        {late
          ? `Проект опаздывает на ${fmtDays(-analysis.bufferDays)} (финиш ${fmtDate(analysis.finishDate)}, дедлайн ${fmtDate(state.project.deadline)}). Каждый вариант уже просчитан по текущему плану${impact ? ' с учётом черновика' : ''}. Выбранный вариант попадёт в черновик, и вы увидите последствия до применения.`
          : `Проект укладывается в срок, запас ${fmtDaysLong(analysis.bufferDays)}. Ниже — как усилить запас и снять перегрузки людей.`}
      </p>

      {advice.plan && (
        <div className="mt-4 overflow-hidden rounded-2xl bg-ink text-white">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
            <h3 className="font-display text-[15px] font-semibold whitespace-nowrap">План восстановления</h3>
            <span
              className={cx(
                'rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap',
                advice.plan.fitsDeadline ? 'bg-moss text-white' : 'bg-white/15 text-white',
              )}
            >
              {advice.plan.fitsDeadline
                ? `укладываемся, запас ${fmtDays(advice.plan.bufferAfter)}`
                : `не хватает ${fmtDays(-advice.plan.bufferAfter)}`}
            </span>
          </div>
          <ol className="mt-3 space-y-2 px-4">
            {advice.plan.steps.map((st, i) => (
              <li key={st.id} className="flex gap-2.5 text-[13px] leading-snug">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold">
                  {i + 1}
                </span>
                <span>
                  {st.title}
                  <span className="text-white/50">, {fmtDays(-st.gainDays)}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
            <p className="text-[13px] text-white/70">
              Финиш после плана: <span className="font-medium text-white">{fmtDate(advice.plan.finishAfter)}</span>
            </p>
            <Button
              size="sm"
              className="border-transparent"
              onClick={() => tryOps(advice.plan!, 'План добавлен в черновик — проверьте последствия')}
            >
              <Check size={14} /> Попробовать план
            </Button>
          </div>
        </div>
      )}

      <div className="mt-6">
        <SectionTitle>{advice.suggestions.length > 0 ? 'Все варианты' : 'Вариантов нет'}</SectionTitle>
        {advice.suggestions.length === 0 && (
          <p className="text-[13px] text-ink-3">
            {late
              ? 'Ускорить критический путь нечем: все задачи на нём короткие или уже в работе.'
              : 'Сейчас ничего менять не нужно.'}
          </p>
        )}
        <ul className="space-y-2">
          {advice.suggestions.map((s) => (
            <li key={s.id} className="rounded-2xl border border-line p-3.5 transition-colors hover:border-ink-3/60">
              <p className="text-[13px] leading-snug font-medium">{s.title}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{s.description}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
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
      </div>
    </section>
  );
}
