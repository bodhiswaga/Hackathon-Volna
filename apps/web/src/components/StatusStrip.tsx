import type { ReactNode } from 'react';
import { Lightbulb } from 'lucide-react';
import type { Health } from '@volna/engine';
import { useModel } from '../lib/model';
import { fmtDate, fmtDays, fmtTasks, HEALTH_COLOR, HEALTH_TEXT } from '../lib/format';
import { useDraft } from '../store/draft';
import { cx, SeaLine } from './ui';

const LIGHT = { ok: '#7fdcb0', attention: '#ffb27a', intervention: '#ff8d9c' } as const;

// Волнение моря = состояние проекта: чем серьёзнее угрозы, тем выше и быстрее волна.
const SEA: Record<Health, { amplitude: number; duration: number }> = {
  ok: { amplitude: 0.3, duration: 22 },
  attention: { amplitude: 0.5, duration: 15 },
  intervention: { amplitude: 0.9, duration: 9 },
};

function Metric({ label, value, was, tone }: { label: string; value: ReactNode; was?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 xl:px-5">
      <p className="text-[12px] whitespace-nowrap text-white/50">{label}</p>
      <p
        className="mt-0.5 font-display text-[19px] leading-6 font-semibold whitespace-nowrap transition-colors duration-500"
        style={{ color: tone }}
      >
        {value}
      </p>
      <p className="h-4 text-[12px] whitespace-nowrap text-white/45">{was != null && <>было {was}</>}</p>
    </div>
  );
}

export function StatusStrip() {
  const { analysis: a, baseAnalysis: b, impact, state } = useModel();
  const setSide = useDraft((s) => s.setSide);
  const side = useDraft((s) => s.side);
  const draft = impact !== null;
  const empty = state.tasks.length === 0;
  const late = a.bufferDays < 0;
  const changed = <T,>(x: T, y: T, fmt: (v: T) => ReactNode) => (draft && x !== y ? fmt(y) : undefined);
  const bufferTone = late ? LIGHT.intervention : a.bufferDays <= 2 ? LIGHT.attention : LIGHT.ok;
  const topAlert = a.alerts[0];
  const sea = empty ? { amplitude: 0.08, duration: 30 } : SEA[a.health];

  return (
    <section className="relative shrink-0 overflow-hidden bg-ink text-white" aria-label="Состояние проекта">
      <SeaLine
        amplitude={sea.amplitude}
        duration={sea.duration}
        color={draft ? 'var(--color-wave)' : empty ? '#8790a5' : LIGHT[a.health]}
        className="absolute inset-x-0 bottom-0 h-8"
      />
      <div className="relative flex flex-wrap items-center gap-x-6 gap-y-3 px-6 pt-3.5 pb-4 xl:gap-x-8">
        <div className="min-w-[220px] flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span
              className={cx('h-2.5 w-2.5 rounded-full transition-colors', a.health === 'intervention' && 'pulse-crimson')}
              style={{ background: empty ? 'var(--color-idle)' : HEALTH_COLOR[a.health] }}
            />
            <h2 className="font-display text-[18px] font-semibold whitespace-nowrap">
              {empty ? 'План пока пуст' : HEALTH_TEXT[a.health]}
            </h2>
            {draft && (
              <span className="rounded-full bg-wave px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white">
                прогноз по черновику
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 max-w-[540px] text-[13px] leading-snug text-white/70">
            {topAlert
              ? topAlert.text + (a.alerts.length > 1 ? ` и ещё ${a.alerts.length - 1}` : '')
              : empty
                ? 'Добавьте задачи и связи между ними — расчёт появится сразу'
                : 'Критический путь в норме, запас до дедлайна есть'}
          </p>
        </div>

        {/* Метрики и советник — одна группа: при переносе строки кнопка остаётся рядом с цифрами */}
        <div className="flex shrink-0 items-center gap-4 xl:gap-6">
        <div className="flex divide-x divide-white/10">
          <Metric
            label="Прогноз финиша"
            value={fmtDate(a.finishDate)}
            was={changed(a.finishDate, b.finishDate, fmtDate)}
            tone={late ? LIGHT.intervention : undefined}
          />
          <Metric
            label="Дедлайн"
            value={fmtDate(state.project.deadline)}
            was={changed(state.project.deadline, impact?.deadlineBefore ?? state.project.deadline, fmtDate)}
          />
          <Metric
            label={late ? 'Опоздание' : 'Запас'}
            value={fmtDays(Math.abs(a.bufferDays))}
            was={changed(a.bufferDays, b.bufferDays, (v) => (v < 0 ? `−${fmtDays(-v)}` : fmtDays(v)))}
            tone={bufferTone}
          />
          <Metric
            label="Критический путь"
            value={fmtTasks(a.stats.critical)}
            was={changed(a.stats.critical, b.stats.critical, (v) => v)}
          />
          <Metric
            label="Под угрозой"
            value={a.stats.threatened}
            was={changed(a.stats.threatened, b.stats.threatened, (v) => v)}
            tone={a.stats.threatened > 0 ? LIGHT.intervention : undefined}
          />
          <Metric label="Готово" value={`${a.stats.progressPct}%`} />
        </div>

        <button
          type="button"
          aria-pressed={side === 'advisor'}
          onClick={() => setSide(side === 'advisor' ? 'auto' : 'advisor')}
          className={cx(
            'flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-[background-color,transform] duration-150 active:scale-[0.97]',
            late
              ? 'bg-wave text-white shadow-[0_6px_20px_-6px_rgb(250_106_31/0.7)] hover:bg-wave-deep'
              : side === 'advisor'
                ? 'bg-white text-ink'
                : 'bg-white/10 text-white hover:bg-white/15',
          )}
        >
          <Lightbulb size={16} />
          {late ? 'Как вернуть сроки' : 'Советник'}
        </button>
        </div>
      </div>
    </section>
  );
}
