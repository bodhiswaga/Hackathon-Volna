import type { ReactNode } from 'react';
import { ChevronRight, Lightbulb } from 'lucide-react';
import { plural, type Health } from '@volna/engine';
import { useModel } from '../lib/model';
import { chanceTone, fmtChance, fmtDate, fmtDays, HEALTH_COLOR, HEALTH_TEXT } from '../lib/format';
import { GLOSSARY } from '../lib/glossary';
import { useDraft } from '../store/draft';
import { cx, SeaLine, Term } from './ui';

const LIGHT = {
  ok: 'var(--color-moss-light)',
  attention: 'var(--color-wave-light)',
  intervention: 'var(--color-crimson-light)',
} as const;
const CHANCE_LIGHT = { moss: 'ok', ochre: 'attention', crimson: 'intervention' } as const;

// Волнение моря = состояние проекта: чем серьёзнее угрозы, тем выше и быстрее волна.
const SEA: Record<Health, { amplitude: number; duration: number }> = {
  ok: { amplitude: 0.3, duration: 22 },
  attention: { amplitude: 0.5, duration: 15 },
  intervention: { amplitude: 0.9, duration: 9 },
};

/** Метрика: подпись с пояснением, значение и «было …» в режиме черновика. */
function Metric({
  label,
  hint,
  value,
  was,
  tone,
  primary,
  className,
}: {
  label: ReactNode;
  hint?: string;
  value: ReactNode;
  was?: ReactNode;
  tone?: string;
  primary?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('min-w-0', className)}>
      <p className="text-[12px] leading-4 whitespace-nowrap text-white/70">
        {hint ? <Term hint={hint}>{label}</Term> : label}
      </p>
      <p
        className={cx(
          'mt-1 font-display font-semibold whitespace-nowrap transition-colors duration-200',
          primary ? 'text-[20px] leading-7 sm:text-[22px]' : 'text-[17px] leading-7',
        )}
        style={{ color: tone }}
      >
        {value}
      </p>
      {/* Строка «было» держит высоту на широком экране, чтобы цифры не прыгали при черновике. */}
      <p
        className={cx(
          'text-[12px] leading-4 whitespace-nowrap text-white/65 sm:h-4',
          was == null && 'max-sm:hidden',
        )}
      >
        {was != null && <>было {was}</>}
      </p>
    </div>
  );
}

export function StatusStrip({ onOpenOverview }: { onOpenOverview?: () => void }) {
  const { analysis: a, baseAnalysis: b, forecast: f, baseForecast: bf, impact, state } = useModel();
  const setSide = useDraft((s) => s.setSide);
  const side = useDraft((s) => s.side);
  const tab = useDraft((s) => s.tab);
  const setTab = useDraft((s) => s.setTab);
  const draft = impact !== null;
  const empty = state.tasks.length === 0;
  const late = a.bufferDays < 0;
  const changed = <T,>(x: T, y: T, fmt: (v: T) => ReactNode) =>
    draft && x !== y ? fmt(y) : undefined;
  const bufferTone = late ? LIGHT.intervention : a.bufferDays <= 2 ? LIGHT.attention : LIGHT.ok;
  const topAlert = a.alerts[0];
  const sea = empty ? { amplitude: 0.08, duration: 30 } : SEA[a.health];

  const summary = (
    <>
      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full transition-colors duration-200"
          style={{ background: empty ? 'var(--color-idle)' : HEALTH_COLOR[a.health] }}
        />
        <span className="font-display text-[18px] leading-6 font-semibold whitespace-nowrap">
          {empty ? 'План пока пуст' : HEALTH_TEXT[a.health]}
        </span>
        {draft && (
          <span className="rounded-md bg-wave px-1.5 py-0.5 text-[12px] leading-4 font-semibold whitespace-nowrap text-white">
            прогноз по черновику
          </span>
        )}
      </span>
      <span className="mt-1 line-clamp-2 block max-w-[560px] text-[13px] leading-[18px] text-white/75">
        {topAlert
          ? topAlert.text +
            (a.alerts.length > 1
              ? ` · ещё ${a.alerts.length - 1} ${plural(a.alerts.length - 1, 'проблема', 'проблемы', 'проблем')}`
              : '')
          : empty
            ? 'Добавьте задачи и связи между ними, расчёт появится сразу'
            : 'Критический путь в норме, запас до дедлайна есть'}
      </span>
    </>
  );

  return (
    <section
      className="relative shrink-0 overflow-hidden bg-ink text-white"
      aria-label="Состояние проекта"
    >
      <SeaLine
        amplitude={sea.amplitude}
        duration={sea.duration}
        color={draft ? 'var(--color-wave)' : empty ? '#8790a5' : LIGHT[a.health]}
        className="absolute inset-x-0 bottom-0 h-8"
      />
      <div className="relative flex flex-wrap items-center gap-x-8 gap-y-3 px-4 pt-3 pb-3.5 md:px-6">
        <div className="flex min-w-0 flex-1 basis-[260px] items-start gap-3">
          {onOpenOverview ? (
            // На узком экране панели «На что обратить внимание» нет рядом — открываем её отсюда.
            <button
              type="button"
              onClick={onOpenOverview}
              className="-mx-2 -my-1 min-w-0 flex-1 rounded-lg px-2 py-1 text-left transition-colors duration-150 hover:bg-white/[0.06] active:bg-white/10"
            >
              {summary}
              <span className="mt-1 inline-flex items-center gap-0.5 text-[12px] font-medium text-white/80">
                Подробнее <ChevronRight size={13} />
              </span>
            </button>
          ) : (
            <div className="min-w-0 flex-1">{summary}</div>
          )}
          <AdvisorButton
            className="flex md:hidden"
            late={late}
            active={side === 'advisor'}
            onClick={() => setSide(side === 'advisor' ? 'auto' : 'advisor')}
          />
        </div>

        <div className="flex w-full items-end gap-6 md:w-auto xl:gap-8">
          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:flex-none sm:items-end sm:gap-x-6 xl:gap-x-7">
            <Metric
              primary
              label="Прогноз финиша"
              hint={GLOSSARY.finish}
              value={fmtDate(a.finishDate)}
              was={changed(a.finishDate, b.finishDate, fmtDate)}
              tone={late ? LIGHT.intervention : undefined}
            />
            <Metric
              primary
              label={late ? 'Опоздание' : 'Запас'}
              hint={late ? GLOSSARY.late : GLOSSARY.buffer}
              value={fmtDays(Math.abs(a.bufferDays))}
              was={changed(a.bufferDays, b.bufferDays, (v) =>
                v < 0 ? `−${fmtDays(-v)}` : fmtDays(v),
              )}
              tone={bufferTone}
            />
            {!empty && (
              <button
                type="button"
                onClick={() => setTab('risks')}
                aria-pressed={tab === 'risks'}
                aria-label={`Шанс успеть ${fmtChance(f.chance)}, открыть вкладку «Риски»`}
                className="-mx-2 -my-1 min-w-0 rounded-lg px-2 py-1 text-left transition-colors duration-150 hover:bg-white/[0.07] active:bg-white/10 aria-pressed:bg-white/[0.07]"
              >
                <Metric
                  primary
                  label={
                    <span className="inline-flex items-center gap-0.5">
                      Шанс успеть <ChevronRight size={12} className="text-white/60" />
                    </span>
                  }
                  value={fmtChance(f.chance)}
                  was={changed(
                    Math.round(f.chance * 100),
                    Math.round(bf.chance * 100),
                    (v) => `${v}%`,
                  )}
                  tone={LIGHT[CHANCE_LIGHT[chanceTone(f.chance)]]}
                />
              </button>
            )}
            <Metric
              label="Под угрозой"
              hint={GLOSSARY.threatened}
              value={a.stats.threatened}
              was={changed(a.stats.threatened, b.stats.threatened, (v) => v)}
              tone={a.stats.threatened > 0 ? LIGHT.intervention : undefined}
            />
            <Metric
              className="hidden sm:block"
              label="Дедлайн"
              value={fmtDate(state.project.deadline)}
              was={changed(
                state.project.deadline,
                impact?.deadlineBefore ?? state.project.deadline,
                fmtDate,
              )}
            />
          </div>
          <AdvisorButton
            className="hidden md:flex"
            late={late}
            active={side === 'advisor'}
            onClick={() => setSide(side === 'advisor' ? 'auto' : 'advisor')}
          />
        </div>
      </div>
    </section>
  );
}

function AdvisorButton({
  late,
  active,
  onClick,
  className,
}: {
  late: boolean;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'mb-4 h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold whitespace-nowrap transition-[background-color,transform] duration-150 active:scale-[0.98] max-md:mb-0',
        late
          ? 'bg-cobalt text-white hover:bg-cobalt-deep'
          : active
            ? 'bg-white text-ink'
            : 'bg-white/10 text-white hover:bg-white/15 active:bg-white/20',
        className,
      )}
    >
      <Lightbulb size={16} />
      {late ? 'Как вернуть сроки' : 'Советник'}
    </button>
  );
}
