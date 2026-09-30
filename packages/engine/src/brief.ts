import { daysText, formatShort } from './calendar';
import { describeOps } from './changeset';
import type {
  Brief,
  BriefSection,
  ChangeOp,
  ImpactReport,
  ISODate,
  ProjectState,
  TeamMessage,
} from './types';

export interface BriefInput {
  before: ProjectState;
  after: ProjectState;
  impact: ImpactReport;
  ops: ChangeOp[];
  reason: string | null;
  /** Выбранное решение (из советника), если черновик собран им. */
  solution?: string | null;
  /** Вероятность уложиться в дедлайн до и после (0…1), если посчитана. */
  chance?: { before: number; after: number };
}

const GREETING = 'Здравствуйте!';

const range = (start: ISODate | null, end: ISODate | null) =>
  !start || !end
    ? '—'
    : start === end
      ? formatShort(end)
      : `${formatShort(start)} – ${formatShort(end)}`;

const signedDays = (n: number) => (n > 0 ? `+${daysText(n)}` : `−${daysText(-n)}`);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const bufferText = (n: number) =>
  n < 0 ? `опоздание ${daysText(-n)}` : n === 0 ? 'без запаса' : `запас ${daysText(n)}`;

/** «Мария Волкова» → «Мария». */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** Готовые тексты об изменении: письмо заказчику и личные сообщения затронутым людям. */
export function buildBrief({
  before,
  after,
  impact,
  ops,
  reason,
  solution,
  chance,
}: BriefInput): Brief {
  const project = after.project.name;
  const deadline = after.project.deadline;
  const lines = describeOps(before, ops);

  const subject =
    impact.finishDelta !== 0
      ? `${project}: прогноз сдачи ${formatShort(impact.finishBefore)} → ${formatShort(impact.finishAfter)}`
      : `${project}: изменения в плане`;

  const happened = [...(reason?.trim() ? [reason.trim()] : []), ...lines.map((l) => `• ${l}`)];

  const timing = [
    impact.finishDelta !== 0
      ? `• Прогноз окончания: ${formatShort(impact.finishBefore)} → ${formatShort(impact.finishAfter)} (${signedDays(impact.finishDelta)})`
      : `• Прогноз окончания не меняется: ${formatShort(impact.finishAfter)}`,
    `• Дедлайн ${formatShort(deadline)}: ${bufferText(impact.bufferAfter)}`,
  ];
  if (chance) {
    timing.push(`• Вероятность успеть к дедлайну: ${pct(chance.before)} → ${pct(chance.after)}`);
  }
  const moved = impact.affected
    .filter((x) => !x.direct && !x.created && x.deltaEnd !== 0)
    .sort((a, b) => b.deltaEnd - a.deltaEnd);
  if (moved.length > 0) {
    const top = moved
      .slice(0, 3)
      .map((x) => `«${x.name}» (${signedDays(x.deltaEnd)})`)
      .join(', ');
    timing.push(
      `• Вслед сдвигаются: ${top}${moved.length > 3 ? ` и ещё ${moved.length - 3}` : ''}`,
    );
  }

  const deadlineMoved = impact.deadlineAfter !== impact.deadlineBefore;
  const ask =
    impact.bufferAfter < 0
      ? `Нужно решение: перенести дедлайн на ${daysText(-impact.bufferAfter)} (до ${formatShort(impact.finishAfter)}) ` +
        'или согласовать дополнительные ресурсы, чтобы ускорить критические работы.'
      : deadlineMoved
        ? `Нужно подтвердить новый срок сдачи: ${formatShort(impact.deadlineBefore)} → ${formatShort(impact.deadlineAfter)}.`
        : impact.bufferAfter < impact.bufferBefore
          ? `Срок сдачи сохраняется, запас сокращается до ${daysText(impact.bufferAfter)}. Решений с вашей стороны не требуется.`
          : 'Срок сдачи сохраняется. Решений с вашей стороны не требуется.';

  // Решение, которое руководитель уже выбрал: заказчик видит не только проблему, но и выход.
  const proposal = solution?.trim()
    ? [
        `Предлагаемое решение: ${solution.trim()}${chance ? ` — вероятность успеть с ним ${pct(chance.after)}` : ''}.`,
      ]
    : [];
  const sections: BriefSection[] = [
    { title: 'Что произошло', lines: happened },
    { title: 'Как это влияет на сроки', lines: timing },
    { title: 'Что нужно от вас', lines: [...proposal, ask] },
  ];
  const client = [GREETING, ...sections.map((x) => [x.title, ...x.lines].join('\n'))].join('\n\n');

  // Коротко для мессенджера: главное в трёх-четырёх строках, без приветствия и списков.
  const shortAsk =
    impact.bufferAfter < 0
      ? `Нужно решение: перенос дедлайна на ${daysText(-impact.bufferAfter)} или доп. ресурсы.`
      : deadlineMoved
        ? `Прошу подтвердить новый срок: ${formatShort(impact.deadlineAfter)}.`
        : chance && chance.after < 0.5
          ? 'Срок формально сохраняется, но запаса нет — держим на контроле.'
          : 'Срок сдачи сохраняется, решений не требуется.';
  const finishLine =
    impact.finishDelta !== 0
      ? `прогноз сдачи ${formatShort(impact.finishBefore)} → ${formatShort(impact.finishAfter)} (${signedDays(impact.finishDelta)})`
      : `прогноз сдачи без изменений — ${formatShort(impact.finishAfter)}`;
  const chanceLine = chance ? `, шанс успеть ${pct(chance.before)} → ${pct(chance.after)}` : '';
  const short = [
    `${project}: ${finishLine}.`,
    `Дедлайн ${formatShort(deadline)}: ${bufferText(impact.bufferAfter)}${chanceLine}.`,
    ...(reason?.trim() ? [`Причина: ${reason.trim()}.`] : []),
    solution?.trim() ? `Решение: ${solution.trim()}. ${shortAsk}` : shortAsk,
  ].join('\n');

  return {
    subject,
    greeting: GREETING,
    sections,
    client,
    short,
    team: teamMessages(before, after, impact, reason),
  };
}

function teamMessages(
  before: ProjectState,
  after: ProjectState,
  impact: ImpactReport,
  reason: string | null,
): TeamMessage[] {
  const byPerson = new Map<string, string[]>();
  const add = (personId: string | null, line: string) => {
    if (!personId) return;
    byPerson.set(personId, [...(byPerson.get(personId) ?? []), line]);
  };
  const beforeTask = new Map(before.tasks.map((t) => [t.id, t]));
  const taskName = (id: string) =>
    beforeTask.get(id)?.name ?? after.tasks.find((t) => t.id === id)?.name ?? '';
  const personName = (id: string | null) =>
    after.people.find((p) => p.id === id)?.name ?? 'другому сотруднику';

  for (const x of impact.affected) {
    const was = beforeTask.get(x.taskId);
    const now = after.tasks.find((t) => t.id === x.taskId);
    if (!now) continue;
    const dates = range(x.startAfter, x.endAfter);
    if (!was) {
      add(now.assigneeId, `• Новая задача «${x.name}»: ${dates}`);
      continue;
    }
    if (was.assigneeId !== now.assigneeId) {
      add(now.assigneeId, `• Вам передана задача «${x.name}»: ${dates}`);
      add(was.assigneeId, `• Задача «${x.name}» передана: ${personName(now.assigneeId)}`);
      continue;
    }
    if (x.deltaStart === 0 && x.deltaEnd === 0) continue;
    // Исполнителю важнее первопричина волны, чем ближайший предшественник.
    const why = !x.direct && x.chain.length > 1 ? `, из-за «${taskName(x.chain[0])}»` : '';
    add(
      now.assigneeId,
      `• «${x.name}»: ${range(x.startBefore, x.endBefore)} → ${dates} (${signedDays(x.deltaEnd || x.deltaStart)})${why}`,
    );
  }

  return after.people.flatMap((p) => {
    const items = byPerson.get(p.id);
    if (!items) return [];
    const text = [
      `${firstName(p.name)}, в плане изменения по вашим задачам:`,
      ...items,
      ...(reason?.trim() ? [`Причина: ${reason.trim()}`] : []),
    ].join('\n');
    return [{ personId: p.id, name: p.name, text }];
  });
}
