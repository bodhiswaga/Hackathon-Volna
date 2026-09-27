import { useState } from 'react';
import { ArrowRight, Check, Lightbulb, Undo2 } from 'lucide-react';
import { describeOps, type Health } from '@volna/engine';
import { useApplyChanges } from '../../api/hooks';
import { fmtDate, fmtDays } from '../../lib/format';
import { useModel } from '../../lib/model';
import { useDraft } from '../../store/draft';
import { Button, Chip, cx, inputClass } from '../ui';

const VERDICT: Record<Health, { title: string; color: string; bg: string }> = {
  ok: { title: 'Можно применять', color: 'var(--color-moss)', bg: 'var(--color-moss-soft)' },
  attention: { title: 'Есть последствия', color: 'var(--color-wave)', bg: 'var(--color-wave-soft)' },
  intervention: { title: 'Требуется вмешательство', color: 'var(--color-crimson)', bg: 'var(--color-crimson-soft)' },
};

const bufferText = (n: number) => (n < 0 ? `опоздание ${fmtDays(-n)}` : `запас ${fmtDays(n)}`);

export function ImpactPanel() {
  const { impact, base, ops } = useModel();
  const clearDraft = useDraft((s) => s.clearDraft);
  const setSide = useDraft((s) => s.setSide);
  const select = useDraft((s) => s.select);
  const apply = useApplyChanges(base.project.id);
  const [reason, setReason] = useState('');
  if (!impact) return null;

  const v = VERDICT[impact.verdict];
  const lines = describeOps(base, ops);
  const waved = impact.affected.filter((x) => !x.direct && !x.created);
  const names = new Map(impact.affected.map((x) => [x.taskId, x.name]));

  return (
    <section className="p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">Что будет, если применить</h2>
        <span className="text-[12px] text-ink-3">черновик не сохранён</span>
      </div>

      <div className="mt-3 rounded-xl p-4" style={{ background: v.bg }}>
        <p className="text-[13px] font-semibold" style={{ color: v.color }}>
          {v.title}
        </p>
        <p className="mt-1 text-[15px] font-medium leading-snug text-ink">{impact.headline}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
          <div>
            <p className="text-ink-3">Финиш проекта</p>
            <p className="font-medium">
              {fmtDate(impact.finishBefore)} <ArrowRight size={12} className="inline" /> {fmtDate(impact.finishAfter)}
              {impact.finishDelta !== 0 && (
                <span className={cx('ml-1', impact.finishDelta > 0 ? 'text-crimson' : 'text-moss')}>
                  ({fmtDays(impact.finishDelta, true)})
                </span>
              )}
            </p>
          </div>
          <div>
            <p className="text-ink-3">До дедлайна</p>
            <p className={cx('font-medium', impact.bufferAfter < 0 && 'text-crimson')}>
              {bufferText(impact.bufferBefore)} <ArrowRight size={12} className="inline" /> {bufferText(impact.bufferAfter)}
            </p>
          </div>
        </div>
      </div>

      <h3 className="mt-5 text-[13px] font-semibold text-ink-2">Изменения в черновике</h3>
      <ul className="mt-1.5 space-y-1 text-[13px]">
        {lines.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
            {l}
          </li>
        ))}
      </ul>

      <h3 className="mt-5 text-[13px] font-semibold text-ink-2">
        {waved.length > 0 ? `Волна: сдвигаются ${waved.length} зависимых задач` : 'Зависимые задачи не сдвигаются'}
      </h3>
      {waved.length > 0 && (
        <ul className="mt-2 space-y-2">
          {waved.map((x) => (
            <li key={x.taskId} className="wave-in" style={{ animationDelay: `${(x.chain.length - 1) * 110}ms` }}>
              <button
                type="button"
                onClick={() => select(x.taskId)}
                className="w-full rounded-lg border border-line px-3 py-2 text-left hover:border-ink-3"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{x.name}</span>
                  {x.criticalAfter && <Chip tone="crimson">крит. путь</Chip>}
                  <Chip tone={x.deltaEnd > 0 ? 'wave' : 'moss'}>{fmtDays(x.deltaEnd, true)}</Chip>
                </div>
                <p className="mt-0.5 text-[12px] text-ink-2">
                  {fmtDate(x.endBefore)} → {fmtDate(x.endAfter)}, {x.reason}
                </p>
                {x.chain.length > 2 && (
                  <p className="mt-0.5 truncate text-[12px] text-ink-3" title={x.chain.map((id) => names.get(id)).join(' → ')}>
                    {x.chain.map((id) => names.get(id)).join(' → ')}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {(impact.attention.length > 0 || impact.resolvedAlerts.length > 0) && (
        <>
          <h3 className="mt-5 text-[13px] font-semibold text-ink-2">На что обратить внимание</h3>
          <ul className="mt-1.5 space-y-1.5 text-[13px]">
            {impact.attention.map((t, i) => (
              <li key={i} className="flex gap-2 text-ink">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-crimson" />
                {t}
              </li>
            ))}
            {impact.resolvedAlerts.map((a) => (
              <li key={a.key} className="flex gap-2 text-moss">
                <Check size={14} className="mt-[3px] shrink-0" />
                <span>
                  Снимается: <span className="text-ink-2">{a.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {impact.bufferAfter < 0 && (
        <Button variant="wave" className="mt-4 w-full" onClick={() => setSide('advisor')}>
          <Lightbulb size={16} /> Подобрать решение
        </Button>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <input
          className={inputClass}
          placeholder="Причина изменения, например «подрядчик сдвинул старт»"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="mt-3 flex gap-2">
          <Button variant="ghost" onClick={clearDraft} className="flex-1">
            <Undo2 size={15} /> Отменить
          </Button>
          <Button
            variant="primary"
            className="flex-[2]"
            disabled={apply.isPending}
            onClick={() => apply.mutate({ ops, reason: reason || undefined }, { onSuccess: () => setReason('') })}
          >
            <Check size={15} /> Применить изменения
          </Button>
        </div>
      </div>
    </section>
  );
}
