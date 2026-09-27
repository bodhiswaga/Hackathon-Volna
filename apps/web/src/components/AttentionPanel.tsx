import { AlertTriangle, CircleAlert, Flame } from 'lucide-react';
import { useModel } from '../lib/model';
import { fmtDate, fmtDays } from '../lib/format';
import { useDraft } from '../store/draft';

export function AttentionPanel() {
  const { analysis: a, state } = useModel();
  const select = useDraft((s) => s.select);
  const byId = new Map(state.tasks.map((t) => [t.id, t]));

  return (
    <div className="p-5">
      <h2 className="text-[15px] font-semibold">На что обратить внимание</h2>
      {a.alerts.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">
          Угроз нет. Выберите задачу на таймлайне и попробуйте изменить её — Волна покажет последствия до того, как вы
          их примените.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {a.alerts.map((al) => (
            <li key={al.key}>
              <button
                type="button"
                onClick={() => al.taskIds[0] && select(al.taskIds[0])}
                className="flex w-full gap-2.5 rounded-lg border border-line px-3 py-2.5 text-left text-[13px] hover:border-ink-3"
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

      {a.criticalPath.length > 0 && (
        <>
          <h2 className="mt-6 flex items-center gap-1.5 text-[15px] font-semibold">
            <Flame size={16} className="text-crimson" /> Критический путь
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">
            Задачи без резерва: задержка любой из них сдвигает финиш проекта.
          </p>
          <ol className="mt-3 border-l-2 border-crimson/30 pl-4">
            {a.criticalPath.map((id) => {
              const t = byId.get(id)!;
              const s = a.tasks[id];
              return (
                <li key={id} className="relative pb-3 last:pb-0">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-crimson" />
                  <button type="button" onClick={() => select(id)} className="text-left">
                    <span className="text-[13px] font-medium hover:underline">{t.name}</span>
                    <span className="block text-[12px] text-ink-3">
                      {fmtDate(s.startDate)} — {fmtDate(s.endDate)}, {t.durationDays > 0 ? fmtDays(t.durationDays) : 'веха'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
      <p className="mt-6 rounded-lg bg-paper px-3 py-2.5 text-[12px] leading-relaxed text-ink-2">
        Выберите задачу, чтобы поменять срок, статус, ответственного или связи. Пока вы не нажали «Применить», все
        изменения — черновик: план не меняется.
      </p>
    </div>
  );
}
