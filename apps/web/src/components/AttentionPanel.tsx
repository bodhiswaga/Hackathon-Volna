import {
  AlertTriangle,
  ChevronRight,
  CircleAlert,
  Flame,
  MousePointerClick,
  Radar,
  ShieldCheck,
} from 'lucide-react';
import { useModel } from '../lib/model';
import { fmtDate, fmtDays } from '../lib/format';
import { useDraft } from '../store/draft';
import { cx } from './ui';

export function AttentionPanel() {
  const { analysis: a, state, threats } = useModel();
  const select = useDraft((s) => s.select);
  const setTab = useDraft((s) => s.setTab);
  const topThreat = threats[0];
  const byId = new Map(state.tasks.map((t) => [t.id, t]));

  return (
    <div className="p-5">
      <h2 className="font-display text-[16px] font-semibold">На что обратить внимание</h2>
      {a.alerts.length === 0 ? (
        <p className="mt-3 flex gap-2.5 rounded-2xl bg-moss-soft px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
          <ShieldCheck size={17} className="mt-px shrink-0 text-moss" />
          Сейчас угроз нет. Выберите задачу и попробуйте изменить её — Волна покажет последствия до
          того, как вы их примените.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {a.alerts.map((al) => (
            <li key={al.key}>
              <button
                type="button"
                onClick={() => al.taskIds[0] && select(al.taskIds[0])}
                className={cx(
                  'flex w-full gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[13px] leading-snug transition-colors',
                  al.severity === 'high'
                    ? 'border-crimson/20 bg-crimson-soft/50 hover:border-crimson/45'
                    : 'border-line hover:border-ink-3',
                )}
              >
                {al.severity === 'high' ? (
                  <AlertTriangle size={16} className="mt-px shrink-0 text-crimson" />
                ) : (
                  <CircleAlert size={16} className="mt-px shrink-0 text-wave" />
                )}
                <span>{al.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {topThreat && (
        <button
          type="button"
          onClick={() => setTab('risks')}
          className="mt-2 flex w-full items-center gap-2.5 rounded-xl border border-line px-3 py-2.5 text-left text-[13px] leading-snug transition-colors hover:border-ink-3"
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
        <>
          <h2 className="mt-7 flex items-center gap-1.5 font-display text-[16px] font-semibold">
            <Flame size={16} className="text-crimson" /> Критический путь
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">
            Задачи без резерва: задержка любой из них сдвигает финиш проекта.
          </p>
          <ol className="mt-3">
            {a.criticalPath.map((id, i) => {
              const t = byId.get(id)!;
              const s = a.tasks[id];
              const last = i === a.criticalPath.length - 1;
              return (
                <li key={id} className="relative flex gap-3">
                  <span className="relative flex w-3 shrink-0 justify-center">
                    <span className="mt-[9px] h-2 w-2 rounded-full bg-crimson ring-4 ring-crimson-soft" />
                    {!last && <span className="absolute top-5 bottom-0 w-px bg-crimson/30" />}
                  </span>
                  <button
                    type="button"
                    onClick={() => select(id)}
                    className="-mx-2 mb-1 min-w-0 flex-1 rounded-lg px-2 py-1 text-left transition-colors hover:bg-paper"
                  >
                    <span className="block truncate text-[13px] font-medium">{t.name}</span>
                    <span className="block text-[12px] text-ink-3">
                      {fmtDate(s.startDate)} — {fmtDate(s.endDate)},{' '}
                      {t.durationDays > 0 ? fmtDays(t.durationDays) : 'веха'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
      <p className="mt-6 flex gap-2.5 rounded-2xl bg-paper px-3.5 py-3 text-[12px] leading-relaxed text-ink-2">
        <MousePointerClick size={16} className="mt-px shrink-0 text-ink-3" />
        Выберите задачу, чтобы поменять срок, статус, ответственного или связи. Пока вы не нажали
        «Применить», все изменения — черновик: план не меняется.
      </p>
    </div>
  );
}
