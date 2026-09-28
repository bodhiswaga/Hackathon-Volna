import { useMemo, useState } from 'react';
import { Copy, Mail, Printer, X } from 'lucide-react';
import { buildBrief } from '@volna/engine';
import { useModel } from '../../lib/model';
import { toast, useDraft } from '../../store/draft';
import { Avatar, Button, Dialog, IconButton, Segmented } from '../ui';

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done, 'success');
  } catch {
    toast('Браузер не дал доступ к буферу обмена — выделите текст и скопируйте вручную', 'error');
  }
}

/** Печать или сохранение в PDF: на странице остаётся только текущая вкладка (см. .print-area). */
function PrintButton() {
  return (
    <Button onClick={() => window.print()} aria-label="Печать или сохранение в PDF">
      <Printer size={15} /> Печать / PDF
    </Button>
  );
}

/** Готовые тексты об изменении из черновика: письмо заказчику и личные сообщения команде. */
export function BriefDialog({ onClose }: { onClose: () => void }) {
  const { base, state, impact, ops, forecast, baseForecast } = useModel();
  const reason = useDraft((s) => s.reason);
  const [tab, setTab] = useState<'client' | 'team'>('client');
  const brief = useMemo(
    () =>
      impact &&
      buildBrief({
        before: base,
        after: state,
        impact,
        ops,
        reason: reason || null,
        chance: { before: baseForecast.chance, after: forecast.chance },
      }),
    [base, state, impact, ops, reason, baseForecast.chance, forecast.chance],
  );
  if (!brief) return null;
  const people = new Map(state.people.map((p) => [p.id, p]));
  const letter = `${brief.subject}\n\n${brief.client}`;

  return (
    <Dialog onClose={onClose} labelledBy="brief-title" width="max-w-2xl">
      <div className="flex items-start gap-3 px-6 pt-6">
        <div className="flex-1">
          <h2 id="brief-title" className="text-lg font-semibold">
            Сообщить об изменении
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">
            Тексты собраны из расчёта черновика. Поправьте причину в панели черновика — они
            обновятся.
          </p>
        </div>
        <IconButton label="Закрыть" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>

      <Segmented
        kind="tab"
        label="Кому сообщить"
        className="mx-6 mt-4"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'client', label: 'Письмо заказчику' },
          { id: 'team', label: `Команде · ${brief.team.length}` },
        ]}
      />

      <div className="px-6 pt-4 pb-6">
        {tab === 'client' ? (
          <>
            <div className="print-area max-h-[52vh] overflow-y-auto rounded-lg border border-line bg-paper px-5 py-4">
              <p className="text-[13px] text-ink-3">
                Тема: <span className="font-medium text-ink">{brief.subject}</span>
              </p>
              <div className="mt-3 space-y-3 text-[14px] leading-relaxed">
                <p>{brief.greeting}</p>
                {brief.sections.map((x) => (
                  <div key={x.title}>
                    <p className="font-semibold">{x.title}</p>
                    {x.lines.map((l, i) => (
                      <p key={i} className="text-ink-2">
                        {l}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <PrintButton />
              <a
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 text-sm font-medium transition-colors duration-150 hover:border-line-strong hover:bg-sunken active:bg-pressed"
                href={`mailto:?subject=${encodeURIComponent(brief.subject)}&body=${encodeURIComponent(brief.client)}`}
              >
                <Mail size={15} /> Открыть в почте
              </a>
              <Button
                variant="primary"
                onClick={() => copy(letter, 'Письмо скопировано')}
                data-autofocus
              >
                <Copy size={15} /> Скопировать письмо
              </Button>
            </div>
          </>
        ) : brief.team.length === 0 ? (
          <p className="rounded-lg border border-line bg-paper px-4 py-3 text-[13px] text-ink-2">
            Сроки и исполнители задач не меняются — команде сообщать нечего.
          </p>
        ) : (
          <>
            <ul className="print-area max-h-[52vh] space-y-2.5 overflow-y-auto">
              {brief.team.map((m) => (
                <li key={m.personId} className="rounded-lg border border-line px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Avatar person={people.get(m.personId)} />
                    <span className="flex-1 text-[13px] font-semibold">{m.name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="print:hidden"
                      onClick={() => copy(m.text, `Сообщение для ${m.name} скопировано`)}
                    >
                      <Copy size={13} /> Скопировать
                    </Button>
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">
                    {m.text}
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <PrintButton />
              <Button
                variant="primary"
                onClick={() =>
                  copy(brief.team.map((m) => m.text).join('\n\n'), 'Сообщения команде скопированы')
                }
              >
                <Copy size={15} /> Скопировать все
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
