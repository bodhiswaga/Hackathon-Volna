import { History, MessageSquareText, RotateCcw } from 'lucide-react';
import { useChanges, useRevert } from '../api/hooks';
import { fmtBuffer, fmtDate, fmtDateTime, fmtDays } from '../lib/format';
import { useModel } from '../lib/model';
import { confirmAction } from '../store/draft';
import { Button, cx, Empty, Skeleton } from './ui';

export function JournalView() {
  const { base } = useModel();
  const { data, isLoading } = useChanges(base.project.id);
  const revert = useRevert(base.project.id);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-6">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <Empty icon={<History size={20} />} title="Журнал пуст">
        Здесь появится каждое применённое изменение: что поменяли, почему и как это сдвинуло срок
        проекта. Любое из них можно откатить.
      </Empty>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h2 className="font-display text-xl font-semibold">Журнал изменений</h2>
      <p className="mt-1 text-sm text-ink-2">
        Новые сверху. Откат возвращает план к состоянию до выбранного изменения.
      </p>
      <ol className="mt-6">
        {data.map((e, i) => {
          const delta = e.bufferBefore - e.bufferAfter;
          const last = i === data.length - 1;
          return (
            <li key={e.id} className="relative flex gap-4">
              <span className="relative flex w-3 shrink-0 justify-center">
                <span
                  className={cx(
                    'mt-5 h-2.5 w-2.5 rounded-full ring-4',
                    delta > 0
                      ? 'bg-crimson ring-crimson-soft'
                      : delta < 0
                        ? 'bg-moss ring-moss-soft'
                        : 'bg-ink-3 ring-paper',
                  )}
                />
                {!last && <span className="absolute top-9 bottom-0 w-px bg-line" />}
              </span>
              <div className="mb-3 min-w-0 flex-1 rounded-2xl border border-line bg-surface p-4">
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:gap-3">
                  <div className="w-full min-w-0 flex-1">
                    <p className="text-[12px] text-ink-3">{fmtDateTime(e.createdAt)}</p>
                    <p className="mt-0.5 text-[14px] leading-snug font-medium">{e.title}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="-ml-2.5 sm:ml-0"
                    disabled={revert.isPending}
                    onClick={async () => {
                      const ok = await confirmAction({
                        title: 'Вернуть план как было?',
                        text: 'План вернётся к состоянию до этого изменения, более поздние изменения тоже отменятся. Откат запишется в журнал.',
                        confirmLabel: 'Вернуть как было',
                      });
                      if (ok) revert.mutate(e.id);
                    }}
                  >
                    <RotateCcw size={13} /> Вернуть как было
                  </Button>
                </div>
                {e.reason && (
                  <p className="mt-2 flex gap-2 text-[13px] text-ink-2">
                    <MessageSquareText size={14} className="mt-[3px] shrink-0 text-ink-3" />
                    {e.reason}
                  </p>
                )}
                <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft pt-3 text-[13px]">
                  <span>
                    Финиш {fmtDate(e.finishBefore)} → {fmtDate(e.finishAfter)}
                    {delta !== 0 && (
                      <span
                        className={cx(
                          'ml-1.5 font-semibold',
                          delta > 0 ? 'text-crimson' : 'text-moss',
                        )}
                      >
                        {fmtDays(delta, true)}
                      </span>
                    )}
                  </span>
                  <span className={e.bufferAfter < 0 ? 'text-crimson' : 'text-ink-3'}>
                    {e.bufferBefore !== e.bufferAfter && `${fmtBuffer(e.bufferBefore)} → `}
                    {fmtBuffer(e.bufferAfter)}
                  </span>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
