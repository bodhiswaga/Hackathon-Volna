import { useState } from 'react';
import { AlertTriangle, ChevronRight, CircleAlert, Radar, ShieldCheck } from 'lucide-react';
import { useModel } from '../lib/model';
import { fmtDays, fmtRange } from '../lib/format';
import { GLOSSARY } from '../lib/glossary';
import { useDraft } from '../store/draft';
import { StatusIcon, Term } from './ui';

// Остальные предупреждения — по кнопке «Ещё», чтобы панель не превращалась в стену текста.
const ALERTS_SHOWN = 3;

const rowClass =
  'flex w-full gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] leading-[18px] transition-colors duration-150 hover:bg-sunken active:bg-pressed';

export function AttentionPanel() {
  const { analysis: a, state, threats } = useModel();
  const select = useDraft((s) => s.select);
  const setTab = useDraft((s) => s.setTab);
  const topThreat = threats[0];
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const [allAlerts, setAllAlerts] = useState(false);
  const alerts = allAlerts ? a.alerts : a.alerts.slice(0, ALERTS_SHOWN);

  return (
    <div className="p-5">
      <h2 className="text-base font-semibold">На что обратить внимание</h2>
      {a.alerts.length === 0 ? (
        <p className="mt-3 flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
          <ShieldCheck size={17} className="mt-px shrink-0 text-moss" />
          Угроз нет. Выберите задачу и измените её: Волна покажет последствия до того, как вы их
          примените.
        </p>
      ) : (
        <ul className="-mx-2.5 mt-2">
          {alerts.map((al) => (
            <li key={al.key}>
              <button
                type="button"
                onClick={() => al.taskIds[0] && select(al.taskIds[0])}
                className={rowClass}
              >
                {al.severity === 'high' ? (
                  <AlertTriangle size={16} className="mt-px shrink-0 text-crimson" />
                ) : (
                  <CircleAlert size={16} className="mt-px shrink-0 text-wave-deep" />
                )}
                <span>{al.text}</span>
              </button>
            </li>
          ))}
          {a.alerts.length > ALERTS_SHOWN && (
            <li>
              <button
                type="button"
                onClick={() => setAllAlerts((v) => !v)}
                className="ml-2.5 rounded-md px-1 py-1 text-[13px] font-medium text-cobalt hover:underline outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
              >
                {allAlerts ? 'Свернуть' : `Ещё ${a.alerts.length - ALERTS_SHOWN}`}
              </button>
            </li>
          )}
        </ul>
      )}

      {topThreat && (
        <button
          type="button"
          onClick={() => setTab('risks')}
          className="mt-3 flex w-full items-center gap-2.5 rounded-lg border border-line px-3 py-2.5 text-left text-[13px] leading-[18px] transition-colors duration-150 hover:border-line-strong hover:bg-sunken active:bg-pressed"
        >
          <Radar size={16} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] text-ink-3">Главный риск по шторм-тесту</span>
            {topThreat.title}:{' '}
            <span className={topThreat.breaksDeadline ? 'text-crimson' : 'text-ochre'}>
              {topThreat.breaksDeadline
                ? `дедлайн сорвётся на ${fmtDays(-topThreat.bufferAfter)}`
                : `финиш ${fmtDays(topThreat.finishDelta, true)}`}
            </span>
          </span>
          <ChevronRight size={15} className="shrink-0 text-ink-3" />
        </button>
      )}

      {a.criticalPath.length > 0 && (
        <div className="mt-6 border-t border-line-soft pt-5">
          <h2 className="text-base font-semibold">
            <Term hint={GLOSSARY.critical}>Критический путь</Term>
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">Задержка любой из них сдвигает финиш.</p>
          <ol className="mt-3">
            {a.criticalPath.map((id, i) => {
              const t = byId.get(id)!;
              const s = a.tasks[id];
              const last = i === a.criticalPath.length - 1;
              return (
                <li key={id} className="relative flex gap-3">
                  <span className="relative flex w-4 shrink-0 justify-center">
                    <StatusIcon
                      status={t.status}
                      size={15}
                      className="relative z-[1] mt-2 bg-surface text-crimson"
                    />
                    {!last && (
                      <span aria-hidden className="absolute top-6 bottom-0 w-px bg-crimson/30" />
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => select(id)}
                    className="-mx-2 mb-0.5 min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-sunken active:bg-pressed"
                  >
                    <span className="block truncate text-[13px] font-medium">{t.name}</span>
                    <span className="block text-[12px] text-ink-3">
                      {fmtRange(s.startDate, s.endDate)},{' '}
                      {t.durationDays > 0 ? fmtDays(t.durationDays) : 'веха'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
