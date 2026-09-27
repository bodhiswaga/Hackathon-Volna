import type { ReactNode } from 'react';
import { Lightbulb } from 'lucide-react';
import { useModel } from '../lib/model';
import { fmtDate, fmtDays, fmtTasks, HEALTH_COLOR, HEALTH_TEXT } from '../lib/format';
import { useDraft } from '../store/draft';
import { cx } from './ui';

function Metric({
  label,
  value,
  was,
  tone,
}: {
  label: string;
  value: ReactNode;
  was?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="min-w-0 px-4 first:pl-0">
      <p className="text-[12px] text-white/55">{label}</p>
      <p className="mt-0.5 whitespace-nowrap text-[18px] font-semibold leading-6" style={{ color: tone }}>
        {value}
      </p>
      <p className="h-4 text-[12px] text-white/45">{was != null && <>было {was}</>}</p>
    </div>
  );
}

export function StatusStrip() {
  const { analysis: a, baseAnalysis: b, impact, state } = useModel();
  const setSide = useDraft((s) => s.setSide);
  const side = useDraft((s) => s.side);
  const draft = impact !== null;
  const empty = state.tasks.length === 0;
  const changed = <T,>(x: T, y: T, fmt: (v: T) => ReactNode) => (draft && x !== y ? fmt(y) : undefined);
  const bufferTone =
    a.bufferDays < 0 ? '#ff8a97' : a.bufferDays <= 2 ? '#ffb36b' : '#7ee0b0';
  const topAlert = a.alerts[0];

  return (
    <section className="relative bg-ink text-white">
      {draft && <div className="absolute inset-x-0 top-0 h-[3px] bg-wave" />}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 px-6 py-4">
        <div className="min-w-[260px] flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span
              className={cx('h-2.5 w-2.5 rounded-full', a.health === 'intervention' && 'pulse-crimson')}
              style={{ background: empty ? 'var(--color-idle)' : HEALTH_COLOR[a.health] }}
            />
            <h2 className="whitespace-nowrap font-display text-[17px] font-bold tracking-tight">
              {empty ? 'План пока пуст' : HEALTH_TEXT[a.health]}
            </h2>
            {draft && (
              <span className="whitespace-nowrap rounded-md bg-wave px-1.5 py-0.5 text-[11px] font-semibold text-white">
                прогноз по черновику
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 max-w-[520px] text-[13px] leading-snug text-white/70">
            {topAlert
              ? topAlert.text + (a.alerts.length > 1 ? ` и ещё ${a.alerts.length - 1}` : '')
              : empty
                ? 'Добавьте задачи и связи между ними — расчёт появится сразу'
                : 'Критический путь в норме, запас до дедлайна есть'}
          </p>
        </div>

        <div className="flex shrink-0 divide-x divide-white/10">
          <Metric
            label="Прогноз финиша"
            value={fmtDate(a.finishDate)}
            was={changed(a.finishDate, b.finishDate, fmtDate)}
            tone={a.bufferDays < 0 ? '#ff8a97' : undefined}
          />
          <Metric
            label="Дедлайн"
            value={fmtDate(state.project.deadline)}
            was={changed(state.project.deadline, impact?.deadlineBefore ?? state.project.deadline, fmtDate)}
          />
          <Metric
            label={a.bufferDays < 0 ? 'Опоздание' : 'Запас'}
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
            tone={a.stats.threatened > 0 ? '#ff8a97' : undefined}
          />
          <Metric label="Готово" value={`${a.stats.progressPct}%`} />
        </div>

        <button
          type="button"
          onClick={() => setSide(side === 'advisor' ? 'auto' : 'advisor')}
          className={cx(
            'flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors',
            a.bufferDays < 0
              ? 'bg-wave text-white hover:bg-wave/90'
              : 'bg-white/10 text-white hover:bg-white/15',
          )}
        >
          <Lightbulb size={16} />
          {a.bufferDays < 0 ? 'Как вернуть сроки' : 'Советник'}
        </button>
      </div>
    </section>
  );
}
