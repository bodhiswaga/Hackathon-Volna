import { History, RotateCcw } from 'lucide-react';
import { useChanges, useRevert } from '../api/hooks';
import { fmtDate, fmtDateTime, fmtDays } from '../lib/format';
import { useModel } from '../lib/model';
import { Button, cx, Empty } from './ui';

export function JournalView() {
  const { base } = useModel();
  const { data, isLoading } = useChanges(base.project.id);
  const revert = useRevert(base.project.id);

  if (isLoading) return <p className="p-6 text-sm text-ink-3">Загружаем журнал…</p>;
  if (!data || data.length === 0) {
    return (
      <Empty title="Журнал пуст">
        Здесь появится каждое применённое изменение: что поменяли, почему и как это сдвинуло срок проекта. Любое из них можно
        откатить.
      </Empty>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <History size={18} /> Журнал изменений
      </h2>
      <ol className="mt-4 space-y-3">
        {data.map((e) => {
          const delta = e.bufferBefore - e.bufferAfter;
          return (
            <li key={e.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-ink-3">{fmtDateTime(e.createdAt)}</p>
                  <p className="mt-0.5 text-[14px] font-medium leading-snug">{e.title}</p>
                  {e.reason && <p className="mt-1 text-[13px] text-ink-2">Причина: {e.reason}</p>}
                  <p className="mt-2 text-[13px]">
                    Финиш {fmtDate(e.finishBefore)} → {fmtDate(e.finishAfter)}
                    {delta !== 0 && (
                      <span className={cx('ml-1.5 font-semibold', delta > 0 ? 'text-crimson' : 'text-moss')}>
                        {fmtDays(delta, true)}
                      </span>
                    )}
                    <span className={cx('ml-3', e.bufferAfter < 0 ? 'text-crimson' : 'text-ink-3')}>
                      {e.bufferAfter < 0 ? `опоздание ${fmtDays(-e.bufferAfter)}` : `запас ${fmtDays(e.bufferAfter)}`}
                    </span>
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={revert.isPending}
                  onClick={() => {
                    if (confirm('Вернуть план к состоянию до этого изменения? Более поздние изменения тоже отменятся.')) {
                      revert.mutate(e.id);
                    }
                  }}
                >
                  <RotateCcw size={13} /> Вернуть как было
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
