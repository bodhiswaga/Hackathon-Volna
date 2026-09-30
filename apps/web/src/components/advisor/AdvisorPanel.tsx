import { useMemo, useState } from 'react';
import { AlertTriangle, BookmarkPlus, Check, Info, UserPlus, X } from 'lucide-react';
import {
  advise,
  applyChangeSet,
  forecast,
  mergeOps,
  type ChangeOp,
  type RecoveryPlan,
  type Suggestion,
} from '@volna/engine';
import { chanceTone, fmtChance, fmtDate, fmtDays, fmtDaysLong, newId } from '../../lib/format';
import { useModel, useProposeAction } from '../../lib/model';
import { sameOps, toast, useDraft } from '../../store/draft';
import { Button, Chip, cx, IconButton, SectionTitle, Segmented } from '../ui';

/** Сколько вариантов показать сразу; остальные — по кнопке. */
const SHOWN = 4;

type PlanKind = 'min' | 'safe';

export function AdvisorPanel() {
  const { state, analysis, today, impact, ops, forecast: current } = useModel();
  const setSide = useDraft((s) => s.setSide);
  const scenarios = useDraft((s) => s.scenarios);
  const saveScenario = useDraft((s) => s.saveScenario);
  const proposeAction = useProposeAction();
  const [planKind, setPlanKind] = useState<PlanKind>('min');
  const [showAll, setShowAll] = useState(false);
  // Советник видит, какие задачи решают срок по прогнозу, — и говорит «почему» конкретно.
  // Id новых задач стабильны, пока план тот же: сохранённый вариант узнаётся по операциям.
  const advice = useMemo(() => {
    const prefix = newId().slice(0, 8);
    let n = 0;
    return advise(state, today, { drivers: current.drivers, newId: () => `${prefix}-${++n}` });
  }, [state, today, current.drivers]);
  const plans = useMemo(
    () =>
      [
        advice.plan && { kind: 'min' as const, label: 'Вернуться в дедлайн', plan: advice.plan },
        advice.safePlan && { kind: 'safe' as const, label: 'С запасом', plan: advice.safePlan },
      ].filter((p): p is { kind: PlanKind; label: string; plan: RecoveryPlan } => Boolean(p)),
    [advice.plan, advice.safePlan],
  );
  const active = plans.find((p) => p.kind === planKind) ?? plans[0];
  // Надёжность каждого плана и варианта — тем же прогнозом, что и в статусной полосе.
  const planChances = useMemo(
    () =>
      new Map(
        plans.map((p) => [p.kind, forecast(applyChangeSet(state, p.plan.ops), today).chance]),
      ),
    [plans, state, today],
  );
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
  const late = analysis.bufferDays < 0;
  const list = showAll ? advice.suggestions : advice.suggestions.slice(0, SHOWN);

  // Решение советника — не причина изменения, поэтому в журнал его не подставляем.
  const tryOps = (s: Pick<Suggestion, 'ops' | 'title'>, message: string) => {
    if (proposeAction(s.ops, { action: s.title })) {
      // Решение попадёт в письмо заказчику («Сообщить»).
      useDraft.setState({ solution: s.title });
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
          ? `Проект опаздывает на ${fmtDays(-analysis.bufferDays)} (финиш ${fmtDate(analysis.finishDate)}, дедлайн ${fmtDate(state.project.deadline)}). Советник перебрал людей, связи и сроки${impact ? ' с учётом черновика' : ''}: у каждого решения — эффект, цена и шанс успеть.`
          : `Проект укладывается в срок, запас ${fmtDaysLong(analysis.bufferDays)}, шанс успеть ${fmtChance(current.chance)}. Ниже — как укрепить самые рискованные места.`}
      </p>

      {active && (
        <div className="mt-4 overflow-hidden rounded-lg border border-line">
          <div className="px-4 pt-4">
            <h3 className="text-sm font-semibold">План восстановления</h3>
            {plans.length > 1 && (
              <Segmented
                className="mt-2.5"
                label="Вариант плана"
                value={active.kind}
                onChange={setPlanKind}
                options={plans.map((p) => ({ id: p.kind, label: p.label }))}
              />
            )}
          </div>
          <PlanBody
            plan={active.plan}
            chance={planChances.get(active.kind) ?? null}
            name={active.kind === 'safe' ? 'План с запасом' : 'План советника'}
            baseOps={ops}
            saved={(planOps) => scenarios.some((s) => sameOps(s.ops, planOps))}
            onSave={(name, planOps) => {
              saveScenario({ id: newId(), name, ops: planOps });
              toast(`«${name}» сохранён в варианты`, 'success');
            }}
            onTry={(name) =>
              tryOps(
                { ...active.plan, title: name },
                'План добавлен в черновик — проверьте последствия',
              )
            }
          />
        </div>
      )}

      <div className="mt-6">
        <SectionTitle>{advice.suggestions.length > 0 ? 'Все решения' : 'Решений нет'}</SectionTitle>
        {advice.suggestions.length === 0 && (
          <p className="text-[13px] text-ink-3">
            {late
              ? 'Ускорить критический путь нечем: все задачи на нём короткие, заблокированы или некому помочь.'
              : 'Сейчас ничего менять не нужно.'}
          </p>
        )}
        <ul className="space-y-2">
          {list.map((s) => (
            <SuggestionCard
              key={s.id}
              s={s}
              chance={chances.get(s.id) ?? 0}
              late={late}
              onTry={() => tryOps(s, 'Решение добавлено в черновик')}
            />
          ))}
        </ul>
        {advice.suggestions.length > SHOWN && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-2 rounded-md px-1 py-1 text-[13px] font-medium text-cobalt hover:underline outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
          >
            {showAll ? 'Свернуть' : `Ещё ${advice.suggestions.length - SHOWN}`}
          </button>
        )}
      </div>
    </section>
  );
}

function PlanBody({
  plan,
  chance,
  name,
  baseOps,
  saved,
  onSave,
  onTry,
}: {
  plan: RecoveryPlan;
  chance: number | null;
  name: string;
  baseOps: ChangeOp[];
  saved: (planOps: ChangeOp[]) => boolean;
  onSave: (name: string, planOps: ChangeOp[]) => void;
  onTry: (name: string) => void;
}) {
  // Вариант = черновик + шаги плана.
  const planOps = useMemo(() => plan.ops.reduce(mergeOps, baseOps), [plan.ops, baseOps]);
  const isSaved = saved(planOps);
  return (
    <>
      <ol className="mt-3 space-y-2.5 px-4">
        {plan.steps.map((st, i) => (
          <li key={st.id} className="flex gap-2.5 text-[13px] leading-snug">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold text-ink-2">
              {i + 1}
            </span>
            <span className="min-w-0">
              {st.title}
              <span className="text-ink-3">, {fmtDays(-st.gainDays)}</span>
              <span className="block text-[12px] text-ink-3">{st.costText}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line-soft px-4 pt-3 text-[13px]">
        <Chip tone={plan.fitsDeadline ? 'moss' : 'neutral'}>
          {plan.fitsDeadline
            ? `финиш ${fmtDate(plan.finishAfter)}, запас ${fmtDays(plan.bufferAfter)}`
            : `не хватает ${fmtDays(-plan.bufferAfter)}`}
        </Chip>
        {chance !== null && <Chip tone={chanceTone(chance)}>шанс успеть {fmtChance(chance)}</Chip>}
      </div>
      {chance !== null && chance < 0.5 && plan.fitsDeadline && (
        <p className="flex gap-1.5 px-4 pt-2 text-[12px] leading-snug text-ink-2">
          <Info size={13} className="mt-0.5 shrink-0 text-ink-3" />
          Формально в дедлайн, но без запаса: любая задержка сорвёт срок. Посмотрите план «С
          запасом» или перенос дедлайна.
        </p>
      )}
      <div className="flex items-center justify-end gap-2 px-4 pt-3 pb-3">
        <Button size="sm" variant="ghost" disabled={isSaved} onClick={() => onSave(name, planOps)}>
          <BookmarkPlus size={14} /> {isSaved ? 'В вариантах' : 'В варианты'}
        </Button>
        <Button size="sm" variant="primary" onClick={() => onTry(name)}>
          <Check size={14} /> Попробовать план
        </Button>
      </div>
    </>
  );
}

function SuggestionCard({
  s,
  chance,
  late,
  onTry,
}: {
  s: Suggestion;
  chance: number;
  late: boolean;
  onTry: () => void;
}) {
  return (
    <li className="rounded-lg border border-line p-3.5 transition-colors duration-150 hover:border-line-strong">
      <p className="flex gap-1.5 text-[13px] leading-snug font-medium">
        {s.kind === 'split' && <UserPlus size={14} className="mt-0.5 shrink-0 text-cobalt" />}
        <span>{s.title}</span>
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{s.description}</p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
        <span className="font-medium text-ink-2">Почему: </span>
        {s.why}
      </p>
      {s.sideEffects.length > 0 && (
        <p className="mt-1.5 flex gap-1.5 text-[12px] leading-snug text-wave-deep">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            Побочный эффект: {s.sideEffects[0]}
            {s.sideEffects.length > 1 && ` и ещё ${s.sideEffects.length - 1}`}
          </span>
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {s.gainDays > 0 && <Chip tone="moss">финиш {fmtDays(-s.gainDays)}</Chip>}
        <Chip tone={chanceTone(chance)}>шанс {fmtChance(chance)}</Chip>
        {late && (
          <Chip tone={s.fitsDeadline ? 'moss' : 'neutral'}>
            {s.fitsDeadline ? 'в дедлайн' : `не хватает ${fmtDays(-s.bufferAfter)}`}
          </Chip>
        )}
        {s.resolves.length > 0 && s.kind === 'reassign' && (
          <Chip tone="cobalt">снимает перегрузку</Chip>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span
          className={cx('min-w-0 flex-1 text-[12px]', s.cost === 3 ? 'text-crimson' : 'text-ink-3')}
        >
          Цена: {s.costText}
        </span>
        <Button size="sm" onClick={onTry}>
          Попробовать
        </Button>
      </div>
    </li>
  );
}
