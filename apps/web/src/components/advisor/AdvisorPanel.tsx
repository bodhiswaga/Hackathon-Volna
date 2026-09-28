import { useMemo } from 'react';
import { BookmarkPlus, Check, X } from 'lucide-react';
import { advise, applyChangeSet, forecast, mergeOps, type Suggestion } from '@volna/engine';
import { chanceTone, fmtChance, fmtDate, fmtDays, fmtDaysLong, newId } from '../../lib/format';
import { useModel, useProposeAction } from '../../lib/model';
import { sameOps, toast, useDraft } from '../../store/draft';
import { Button, Chip, cx, IconButton, SectionTitle } from '../ui';

const COST_LABEL = { 1: 'низкая', 2: 'средняя', 3: 'высокая' } as const;

export function AdvisorPanel() {
  const { state, analysis, today, impact, ops } = useModel();
  const setSide = useDraft((s) => s.setSide);
  const scenarios = useDraft((s) => s.scenarios);
  const saveScenario = useDraft((s) => s.saveScenario);
  const proposeAction = useProposeAction();
  const advice = useMemo(() => advise(state, today), [state, today]);
  // План советника считается по черновику: вариант = черновик + шаги плана.
  const planOps = useMemo(
    () => (advice.plan ? advice.plan.ops.reduce(mergeOps, ops) : null),
    [advice.plan, ops],
  );
  const planChance = useMemo(
    () => (advice.plan ? forecast(applyChangeSet(state, advice.plan.ops), today).chance : null),
    [advice.plan, state, today],
  );
  // Надёжность каждого варианта — тем же прогнозом, что и в статусной полосе (прогонов меньше ради скорости).
  const chances = useMemo(
    () =>
      new Map(
        advice.suggestions.map((s) => [
          s.id,
          forecast(applyChangeSet(state, s.ops), today, { runs: 600 }).chance,
        ]),
      ),
    [advice.suggestions, state, today],
  );
  const planSaved = planOps !== null && scenarios.some((s) => sameOps(s.ops, planOps));
  const late = analysis.bufferDays < 0;

  // Решение советника — не причина изменения, поэтому в журнал его не подставляем.
  const tryOps = (s: Pick<Suggestion, 'ops' | 'title'>, message: string) => {
    if (proposeAction(s.ops, { action: s.title })) {
      toast(message, 'success');
      setSide('auto');
    }
  };

  return (
    <section className="p-5">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-base font-semibold">Советник по срокам</h2>
        <IconButton
          className="in-sheet:hidden"
          label="Закрыть советника"
          onClick={() => setSide('auto')}
        >
          <X size={16} />
        </IconButton>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        {late
          ? `Проект опаздывает на ${fmtDays(-analysis.bufferDays)} (финиш ${fmtDate(analysis.finishDate)}, дедлайн ${fmtDate(state.project.deadline)}). Каждый вариант уже просчитан по текущему плану${impact ? ' с учётом черновика' : ''}. Выбранный вариант попадёт в черновик, и вы увидите последствия до применения.`
          : `Проект укладывается в срок, запас ${fmtDaysLong(analysis.bufferDays)}. Ниже — как усилить запас и снять перегрузки людей.`}
      </p>

      {advice.plan && (
        <div className="mt-4 overflow-hidden rounded-lg border border-line">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
            <h3 className="text-sm font-semibold whitespace-nowrap">План восстановления</h3>
            <span
              className={cx(
                'rounded-md px-1.5 py-0.5 text-[12px] font-medium whitespace-nowrap',
                advice.plan.fitsDeadline ? 'bg-moss-soft text-moss' : 'bg-sunken text-ink-2',
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
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold text-ink-2">
                  {i + 1}
                </span>
                <span>
                  {st.title}
                  <span className="text-ink-3">, {fmtDays(-st.gainDays)}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 border-t border-line-soft px-4 pt-3 text-[13px] text-ink-2">
            Финиш после плана:{' '}
            <span className="font-medium text-ink">{fmtDate(advice.plan.finishAfter)}</span>
            {planChance !== null && (
              <>
                , шанс успеть{' '}
                <span className={cx('font-medium', planChance < 0.5 ? 'text-crimson' : 'text-ink')}>
                  {fmtChance(planChance)}
                </span>
              </>
            )}
          </p>
          {planChance !== null && planChance < 0.5 && advice.plan.fitsDeadline && (
            <p className="px-4 pt-1 text-[12px] leading-snug text-ink-3">
              Дедлайн формально сохраняется, но запаса почти нет: сравните с переносом дедлайна.
            </p>
          )}
          <div className="flex items-center justify-end gap-2 px-4 pt-3 pb-3">
            <Button
              size="sm"
              variant="ghost"
              disabled={planSaved}
              onClick={() => {
                saveScenario({ id: newId(), name: 'План советника', ops: planOps! });
                toast('План советника сохранён в варианты', 'success');
              }}
            >
              <BookmarkPlus size={14} /> {planSaved ? 'В вариантах' : 'В варианты'}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                tryOps(
                  { ...advice.plan!, title: 'План советника' },
                  'План добавлен в черновик — проверьте последствия',
                )
              }
            >
              <Check size={14} /> Попробовать план
            </Button>
          </div>
        </div>
      )}

      <div className="mt-6">
        <SectionTitle>
          {advice.suggestions.length > 0 ? 'Все варианты' : 'Вариантов нет'}
        </SectionTitle>
        {advice.suggestions.length === 0 && (
          <p className="text-[13px] text-ink-3">
            {late
              ? 'Ускорить критический путь нечем: все задачи на нём короткие или уже в работе.'
              : 'Сейчас ничего менять не нужно.'}
          </p>
        )}
        <ul className="space-y-2">
          {advice.suggestions.map((s) => (
            <li
              key={s.id}
              className="rounded-lg border border-line p-3.5 transition-colors duration-150 hover:border-line-strong"
            >
              <p className="text-[13px] leading-snug font-medium">{s.title}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{s.description}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {s.gainDays > 0 && <Chip tone="moss">финиш {fmtDays(-s.gainDays)}</Chip>}
                <Chip tone={chanceTone(chances.get(s.id) ?? 0)}>
                  шанс {fmtChance(chances.get(s.id) ?? 0)}
                </Chip>
                {late && (
                  <Chip tone={s.fitsDeadline ? 'moss' : 'neutral'}>
                    {s.fitsDeadline
                      ? 'укладываемся в дедлайн'
                      : `ещё не хватает ${fmtDays(-s.bufferAfter)}`}
                  </Chip>
                )}
                {s.resolves.length > 0 && s.kind === 'reassign' && (
                  <Chip tone="cobalt">снимает перегрузку</Chip>
                )}
                <span className={cx('text-[12px]', s.cost === 3 ? 'text-crimson' : 'text-ink-3')}>
                  цена: {COST_LABEL[s.cost]}
                </span>
                <Button
                  size="sm"
                  className="ml-auto"
                  onClick={() => tryOps(s, 'Вариант добавлен в черновик')}
                >
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
