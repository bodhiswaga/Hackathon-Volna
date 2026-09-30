import { useState } from 'react';
import { ArrowRight, Check, ChevronDown, Lightbulb, Megaphone, X } from 'lucide-react';
import { describeOps, type Health } from '@volna/engine';
import {
  chanceText,
  fmtBuffer,
  fmtChance,
  fmtDate,
  fmtDays,
  fmtShiftedTasks,
} from '../../lib/format';
import { GLOSSARY } from '../../lib/glossary';
import { useModel, useRemoveDraftOp } from '../../lib/model';
import { useDraft } from '../../store/draft';
import { BriefDialog } from '../brief/BriefDialog';
import { Button, Chip, cx, IconButton, SectionTitle, Term, Tooltip } from '../ui';

export const VERDICT: Record<Health, { title: string; color: string; bg: string }> = {
  ok: { title: 'Можно применять', color: 'var(--color-moss)', bg: 'var(--color-moss-soft)' },
  attention: {
    title: 'Есть последствия',
    color: 'var(--color-wave-deep)',
    bg: 'var(--color-wave-soft)',
  },
  intervention: {
    title: 'Требуется вмешательство',
    color: 'var(--color-crimson)',
    bg: 'var(--color-crimson-soft)',
  },
};

/** Сколько задач волны показывать сразу; остальные — по кнопке, чтобы панель не разрасталась. */
const WAVE_PREVIEW = 4;

export function ImpactPanel() {
  const { impact, base, ops, forecast, baseForecast } = useModel();
  const setSide = useDraft((s) => s.setSide);
  const select = useDraft((s) => s.select);
  const [showAll, setShowAll] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const removeOp = useRemoveDraftOp();
  if (!impact) return null;

  const v = VERDICT[impact.verdict];
  // По строке на правку: у каждой свой крестик. Созданные в черновике задачи нужны для имён.
  const named = {
    ...base,
    tasks: [...base.tasks, ...ops.flatMap((o) => (o.type === 'createTask' ? [o.task] : []))],
  };
  const lines = ops.map((op) => describeOps(named, [op]).join('; '));
  const waved = impact.affected.filter((x) => !x.direct && !x.created);
  const visible = showAll ? waved : waved.slice(0, WAVE_PREVIEW);
  const names = new Map(impact.affected.map((x) => [x.taskId, x.name]));

  return (
    <section className="p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Что будет, если применить</h2>
        <Tooltip content="Письмо заказчику и сообщения команде" describe={false}>
          <Button size="sm" variant="ghost" onClick={() => setBriefOpen(true)}>
            <Megaphone size={14} /> Сообщить
          </Button>
        </Tooltip>
      </div>
      {briefOpen && <BriefDialog onClose={() => setBriefOpen(false)} />}

      <div className="mt-3 rounded-lg p-4" style={{ background: v.bg }}>
        <p
          className="flex items-center gap-1.5 text-[13px] font-semibold"
          style={{ color: v.color }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: v.color }} />
          {v.title}
        </p>
        <p className="mt-1.5 text-[15px] leading-snug font-medium text-ink">{impact.headline}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-ink/[0.07] pt-3 text-[13px]">
          <div>
            <p className="text-ink-2">Финиш проекта</p>
            <p className="font-medium">
              {fmtDate(impact.finishBefore)} <ArrowRight size={12} className="inline text-ink-2" />{' '}
              {fmtDate(impact.finishAfter)}
              {impact.finishDelta !== 0 && (
                <span className={cx('ml-1', impact.finishDelta > 0 ? 'text-crimson' : 'text-moss')}>
                  ({fmtDays(impact.finishDelta, true)})
                </span>
              )}
            </p>
          </div>
          <div>
            <p className="text-ink-2">До дедлайна</p>
            <p className={cx('font-medium', impact.bufferAfter < 0 && 'text-crimson')}>
              {fmtBuffer(impact.bufferBefore)}{' '}
              <ArrowRight size={12} className="inline text-ink-2" /> {fmtBuffer(impact.bufferAfter)}
            </p>
          </div>
          <div className="col-span-2 flex items-baseline justify-between gap-2">
            <p className="text-ink-2">
              <Term hint={GLOSSARY.chance}>Шанс успеть к дедлайну</Term>
            </p>
            <p className="font-medium">
              {fmtChance(baseForecast.chance)}{' '}
              <ArrowRight size={12} className="inline text-ink-2" />{' '}
              <span className={chanceText(forecast.chance)}>{fmtChance(forecast.chance)}</span>
            </p>
          </div>
        </div>
      </div>

      {impact.bufferAfter < 0 && (
        <Button variant="primary" className="mt-3 w-full" onClick={() => setSide('advisor')}>
          <Lightbulb size={16} /> Подобрать решение
        </Button>
      )}

      <div className="mt-5">
        <SectionTitle>Изменения в черновике</SectionTitle>
        <ul className="-mx-2 space-y-0.5 text-[13px]">
          {lines.map((l, i) => (
            <li
              key={i}
              className="group flex items-start gap-2 rounded-md py-1 pr-1 pl-2 transition-colors duration-150 hover:bg-sunken"
            >
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3" />
              <span className="min-w-0 flex-1">{l}</span>
              <IconButton
                label="Убрать эту правку"
                className="-my-1 h-7 w-7 opacity-60 group-hover:opacity-100 hover:bg-crimson-soft hover:text-crimson"
                onClick={() => removeOp(i)}
              >
                <X size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5">
        <SectionTitle>
          {waved.length > 0
            ? `Волна: ${fmtShiftedTasks(waved.length)}`
            : 'Зависимые задачи не сдвигаются'}
        </SectionTitle>
        {waved.length > 0 && (
          <ol className="relative -mx-2 border-l-2 border-wave/30 pl-2">
            {visible.map((x) => (
              <li
                key={x.taskId}
                className="wave-in"
                style={{ animationDelay: `${(x.chain.length - 1) * 60}ms` }}
              >
                <button
                  type="button"
                  onClick={() => select(x.taskId)}
                  className="w-full rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-sunken active:bg-pressed"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {x.name}
                    </span>
                    {x.criticalAfter && <Chip tone="crimson">крит. путь</Chip>}
                    <Chip tone={x.deltaEnd > 0 ? 'wave' : 'moss'}>{fmtDays(x.deltaEnd, true)}</Chip>
                  </div>
                  <p className="mt-0.5 text-[12px] leading-snug text-ink-2">
                    {fmtDate(x.endBefore)} → {fmtDate(x.endAfter)}, {x.reason}
                  </p>
                  {x.chain.length > 2 && (
                    <p
                      className="mt-0.5 truncate text-[12px] text-ink-3"
                      title={x.chain.map((id) => names.get(id)).join(' → ')}
                    >
                      {x.chain.map((id) => names.get(id)).join(' → ')}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ol>
        )}
        {waved.length > WAVE_PREVIEW && (
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="mt-1 -ml-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:bg-sunken hover:text-ink"
          >
            <ChevronDown
              size={14}
              className={cx('transition-transform duration-200', showAll && 'rotate-180')}
            />
            {showAll ? 'Свернуть' : `Ещё ${waved.length - WAVE_PREVIEW}`}
          </button>
        )}
      </div>

      {(impact.attention.length > 0 || impact.resolvedAlerts.length > 0) && (
        <div className="mt-5">
          <SectionTitle>На что обратить внимание</SectionTitle>
          <ul className="space-y-1.5 text-[13px]">
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
        </div>
      )}
    </section>
  );
}
