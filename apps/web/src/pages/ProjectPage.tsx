import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowLeft,
  BookmarkPlus,
  Check,
  ChevronDown,
  Columns3,
  FolderOpen,
  Plus,
  RotateCcw,
  Settings2,
  Undo2,
} from 'lucide-react';
import { plural, summarizeOps } from '@volna/engine';
import { useApplyChanges, useProject, useResetDemo } from '../api/hooks';
import { AdvisorPanel } from '../components/advisor/AdvisorPanel';
import { AttentionPanel } from '../components/AttentionPanel';
import { EventHost, EventsMenu } from '../components/events/EventDialog';
import { GanttView } from '../components/gantt/GanttView';
import { ImpactPanel, VERDICT } from '../components/impact/ImpactPanel';
import { JournalView } from '../components/JournalView';
import { ProjectSettings } from '../components/ProjectSettings';
import { RisksView } from '../components/risks/RisksView';
import { CompareHost } from '../components/scenarios/ScenarioCompare';
import { StatusStrip } from '../components/StatusStrip';
import { TaskTable } from '../components/table/TaskTable';
import { TaskEditor } from '../components/task/TaskEditor';
import { TeamView } from '../components/TeamView';
import {
  Button,
  cx,
  Empty,
  inputClass,
  MenuItem,
  Popover,
  Sheet,
  Skeleton,
  Tooltip,
  WaveMark,
} from '../components/ui';
import { fmtChance, fmtDate, fmtDays, newId } from '../lib/format';
import { ModelContext, useAddTask, useModel, useProjectModel } from '../lib/model';
import { navigate } from '../lib/router';
import { useMediaQuery, WIDE_LAYOUT } from '../lib/useMediaQuery';
import {
  confirmAction,
  sameOps,
  SCENARIO_LETTERS,
  toast,
  useDraft,
  type ViewTab,
} from '../store/draft';

// Граф (React Flow + dagre) — самая тяжёлая часть бандла, грузим его только при открытии вкладки.
const GraphView = lazy(() =>
  import('../components/graph/GraphView').then((m) => ({ default: m.GraphView })),
);

const TABS: { id: ViewTab; label: string }[] = [
  { id: 'timeline', label: 'Таймлайн' },
  { id: 'risks', label: 'Риски' },
  { id: 'graph', label: 'Граф связей' },
  { id: 'table', label: 'Задачи' },
  { id: 'team', label: 'Команда' },
  { id: 'journal', label: 'Журнал' },
];

export function ProjectPage({ id }: { id: string }) {
  const { data, isLoading, error, refetch, isRefetching } = useProject(id);
  const openProject = useDraft((s) => s.openProject);
  useEffect(() => openProject(id), [id, openProject]);
  const model = useProjectModel(data);

  if (isLoading) return <ProjectSkeleton />;
  if (error || !model) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty
          title="Проект не загрузился"
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => navigate('/')}>
                Все проекты
              </Button>
              <Button variant="primary" onClick={() => refetch()} disabled={isRefetching}>
                <RotateCcw size={15} /> Повторить
              </Button>
            </div>
          }
        >
          {error?.message ?? 'Сервер не вернул данные проекта.'}
        </Empty>
      </div>
    );
  }

  return (
    <ModelContext.Provider value={model}>
      <ProjectLayout />
      <EventHost />
      <CompareHost />
      <DraftUndoHotkey />
    </ModelContext.Provider>
  );
}

/** Ctrl+Z (⌘Z) возвращает черновик на шаг назад — кроме случаев, когда фокус в поле ввода. */
function DraftUndoHotkey() {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      if (
        (e.target as HTMLElement | null)?.closest(
          'input, textarea, select, [contenteditable="true"]',
        )
      ) {
        return;
      }
      if (useDraft.getState().undo()) {
        e.preventDefault();
        toast('Черновик: шаг назад', 'info');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return null;
}

/**
 * Каркас страницы. На широком экране боковая колонка стоит рядом с видом,
 * на узком — открывается шторкой; пока шторка открыта, остальная страница inert.
 */
function ProjectLayout() {
  const wide = useMediaQuery(WIDE_LAYOUT);
  const selectedTaskId = useDraft((s) => s.selectedTaskId);
  const side = useDraft((s) => s.side);
  const select = useDraft((s) => s.select);
  const hasDraft = useDraft((s) => s.ops.length > 0);
  // «Обзор» — панель без выбранной задачи; на узком экране открывается по запросу.
  const [overviewOpen, setOverviewOpen] = useState(false);
  const sheetOpen = !wide && (selectedTaskId !== null || side !== 'auto' || overviewOpen);

  const closeSheet = () => {
    setOverviewOpen(false);
    select(null);
  };

  return (
    <>
      <div
        className={cx('flex h-full flex-col', !wide && hasDraft && !sheetOpen && 'pb-[124px]')}
        inert={sheetOpen}
      >
        <TopBar />
        <StatusStrip onOpenOverview={wide ? undefined : () => setOverviewOpen(true)} />
        <div className="flex min-h-0 flex-1">
          <MainView />
          {wide && (
            <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface xl:w-[400px]">
              <SideColumn />
            </aside>
          )}
        </div>
      </div>
      {!wide && (
        <>
          <Sheet open={sheetOpen} onClose={closeSheet} label={sheetLabel(selectedTaskId, side)}>
            <SideColumn />
          </Sheet>
          {hasDraft && !sheetOpen && (
            <div className="animate-toast-in fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface">
              <DraftBar compact onDetails={() => setOverviewOpen(true)} />
            </div>
          )}
        </>
      )}
    </>
  );
}

function sheetLabel(selectedTaskId: string | null, side: string): string {
  if (side === 'advisor') return 'Советник по срокам';
  if (side === 'project') return 'Параметры проекта';
  return selectedTaskId ? 'Задача' : 'Обзор проекта';
}

function ProjectSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy="true" aria-label="Загрузка проекта">
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-surface px-3 xl:px-4">
        <WaveMark animated={false} />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="ml-auto hidden h-4 w-96 md:block" />
        <Skeleton className="ml-auto h-8 w-24 md:ml-0" />
      </div>
      <div className="h-[92px] shrink-0 bg-ink px-6 pt-4">
        <div className="h-4 w-40 rounded-md bg-white/10" />
        <div className="mt-3 h-3 w-72 rounded-md bg-white/5" />
      </div>
      <div className="flex min-h-0 flex-1 bg-surface">
        <div className="flex-1">
          <div className="h-[52px] border-b border-line" />
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex h-10 items-center gap-4 border-b border-line-soft px-4">
              <Skeleton className="h-3 w-40 shrink-0" />
              <Skeleton
                className="h-[18px]"
                style={{ marginLeft: `${8 + i * 6}%`, width: `${10 + ((i * 7) % 14)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="hidden w-[360px] border-l border-line p-5 lg:block xl:w-[400px]">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="mt-4 h-16" />
          <Skeleton className="mt-3 h-10" />
        </div>
      </div>
    </div>
  );
}

function TopBar() {
  const { state } = useModel();
  const reset = useResetDemo();
  const setSide = useDraft((s) => s.setSide);
  const addTask = useAddTask();
  const isDemo = state.project.id === 'demo';

  return (
    <header className="relative z-30 shrink-0 border-b border-line bg-surface">
      <div className="flex h-[52px] items-center gap-1 px-2 md:gap-2 md:px-3 xl:px-4">
        <Tooltip content="Все проекты" describe={false}>
          <a
            href="#/"
            className="flex shrink-0 items-center gap-2 rounded-lg p-1 transition-colors duration-150 hover:bg-sunken active:bg-pressed xl:pr-2.5"
            aria-label="Все проекты"
          >
            <WaveMark />
            <span className="hidden font-display font-semibold xl:inline">Волна</span>
          </a>
        </Tooltip>
        <span className="hidden text-line-strong md:inline" aria-hidden>
          /
        </span>

        <div className="min-w-0 flex-1 lg:flex-initial">
          <Popover
            label="Меню проекта"
            buttonClassName="flex w-full max-w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors duration-150 hover:bg-sunken active:bg-pressed aria-expanded:bg-sunken md:w-auto lg:max-w-[220px] xl:max-w-[360px] 2xl:max-w-[440px]"
            button={(open) => (
              <>
                <span className="min-w-0">
                  <span className="block truncate text-sm leading-5 font-semibold">
                    {state.project.name}
                  </span>
                  <span className="block truncate text-[12px] leading-4 text-ink-3">
                    {fmtDate(state.project.startDate)} — {fmtDate(state.project.deadline)}
                  </span>
                </span>
                <ChevronDown
                  size={15}
                  className={cx(
                    'shrink-0 text-ink-3 transition-transform duration-200',
                    open && 'rotate-180',
                  )}
                />
              </>
            )}
            panelClassName="w-80 max-w-[calc(100vw-16px)]"
          >
            {(close) => (
              <>
                {state.project.description && (
                  <p className="px-2.5 pt-2 pb-2 text-[13px] leading-snug text-ink-2">
                    {state.project.description}
                  </p>
                )}
                <MenuItem
                  icon={<Settings2 size={16} />}
                  hint="Название, старт и дедлайн"
                  onClick={() => {
                    close();
                    setSide('project');
                  }}
                >
                  Параметры проекта
                </MenuItem>
                {isDemo && (
                  <MenuItem
                    icon={<RotateCcw size={16} />}
                    hint="Вернуть исходный план и очистить журнал"
                    onClick={async () => {
                      close();
                      const ok = await confirmAction({
                        title: 'Сбросить демо-проект?',
                        text: 'Все изменения и журнал будут удалены, план вернётся к исходному состоянию.',
                        confirmLabel: 'Сбросить демо',
                        danger: true,
                      });
                      if (ok) reset.mutate();
                    }}
                  >
                    Сбросить демо
                  </MenuItem>
                )}
                <div className="mx-2.5 my-1 border-t border-line-soft" />
                <MenuItem icon={<FolderOpen size={16} />} onClick={() => navigate('/')}>
                  Все проекты
                </MenuItem>
              </>
            )}
          </Popover>
        </div>

        <Tabs className="mx-auto hidden lg:flex" />

        <VariantsButton />
        <EventsMenu />
        <Tooltip content="Новая задача" describe={false}>
          <Button
            variant="primary"
            size="sm"
            className="w-8 shrink-0 px-0 xl:w-auto xl:px-3"
            onClick={addTask}
            aria-label="Новая задача"
          >
            <Plus size={16} /> <span className="hidden xl:inline">Задача</span>
          </Button>
        </Tooltip>
      </div>
      <Tabs className="flex border-t border-line-soft px-2 lg:hidden" />
    </header>
  );
}

/**
 * Вкладки вида. Подчёркивание переезжает к выбранной через transform — видно, куда переключились,
 * и без пересчёта вёрстки. Стрелки влево/вправо переключают вкладки с клавиатуры.
 */
function Tabs({ className }: { className?: string }) {
  const tab = useDraft((s) => s.tab);
  const setTab = useDraft((s) => s.setTab);
  const listRef = useRef<HTMLElement>(null);

  // На узком экране вкладки прокручиваются: активная всегда в зоне видимости.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-tab="${tab}"]`)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    setTab(next.id);
    listRef.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  return (
    <nav
      ref={listRef}
      role="tablist"
      aria-label="Представление проекта"
      onKeyDown={onKeyDown}
      className={cx(
        'relative shrink-0 self-stretch overflow-x-auto [scrollbar-width:none]',
        className,
      )}
    >
      {TABS.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            data-tab={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={cx(
              'flex h-11 shrink-0 items-stretch rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-offset-[-8px] lg:h-full lg:px-2.5 xl:px-3',
              active ? 'text-ink' : 'text-ink-3 hover:text-ink',
            )}
          >
            {/* Полоса — часть надписи: всегда ровно по её ширине, без замеров и при любом шрифте. */}
            <span data-tab-label className="relative flex items-center">
              {t.label}
              <span
                aria-hidden
                className={cx(
                  'pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-center rounded-full bg-cobalt transition-transform duration-200 ease-[var(--ease-out-soft)]',
                  active ? 'scale-x-100' : 'scale-x-0',
                )}
              />
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function MainView() {
  const tab = useDraft((s) => s.tab);
  // key: при смене вкладки область пересоздаётся — короткое появление показывает, что вид сменился.
  return (
    <main key={tab} className="animate-view-in min-w-0 flex-1 overflow-auto bg-surface">
      <CurrentView tab={tab} />
    </main>
  );
}

function GraphSkeleton() {
  return (
    <div
      className="flex flex-col items-center gap-5 p-8"
      aria-busy="true"
      aria-label="Загрузка графа"
    >
      <Skeleton className="h-16 w-56" />
      <div className="flex gap-6">
        <Skeleton className="h-16 w-56" />
        <Skeleton className="h-16 w-56" />
      </div>
      <Skeleton className="h-16 w-56" />
      <div className="flex gap-6">
        <Skeleton className="h-16 w-56" />
        <Skeleton className="h-16 w-56" />
      </div>
    </div>
  );
}

function CurrentView({ tab }: { tab: ViewTab }) {
  switch (tab) {
    case 'timeline':
      return <GanttView />;
    case 'risks':
      return <RisksView />;
    case 'graph':
      return (
        <Suspense fallback={<GraphSkeleton />}>
          <GraphView />
        </Suspense>
      );
    case 'table':
      return <TaskTable />;
    case 'journal':
      return <JournalView />;
    case 'team':
      return <TeamView />;
  }
}

/**
 * Содержимое боковой колонки: панель и закреплённый снизу черновик.
 * Полная панель последствий открывается по «Подробнее» и живёт, пока не сменилась задача или панель.
 */
function SideColumn() {
  const side = useDraft((s) => s.side);
  const selectedTaskId = useDraft((s) => s.selectedTaskId);
  const hasDraft = useDraft((s) => s.ops.length > 0);
  const panelKey = `${side}:${selectedTaskId ?? ''}`;
  const [impactFor, setImpactFor] = useState<string | null>(null);
  const showImpact = hasDraft && impactFor === panelKey;
  const scrollRef = useRef<HTMLDivElement>(null);
  // Другая задача или панель — начинаем с её верха, а не с места, где остановились в прошлой.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [panelKey]);

  const openImpact = () => {
    setImpactFor(panelKey);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  return (
    <>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div key={showImpact ? 'impact' : panelKey} className="animate-view-in">
          {showImpact ? (
            <>
              <button
                type="button"
                onClick={() => setImpactFor(null)}
                className="mx-3 mt-3 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:bg-sunken hover:text-ink active:bg-pressed"
              >
                <ArrowLeft size={15} />
                {selectedTaskId ? 'К задаче' : side === 'auto' ? 'Назад' : 'К панели'}
              </button>
              <ImpactPanel />
            </>
          ) : (
            <SidePanel />
          )}
        </div>
      </div>
      {/* Без выбранной задачи панель последствий и так открыта — «Подробнее» не нужно. */}
      {hasDraft && (
        <DraftBar
          onDetails={showImpact || (side === 'auto' && !selectedTaskId) ? undefined : openImpact}
        />
      )}
    </>
  );
}

function SidePanel() {
  const side = useDraft((s) => s.side);
  const selectedTaskId = useDraft((s) => s.selectedTaskId);
  const { impact, state } = useModel();
  if (side === 'advisor') return <AdvisorPanel />;
  if (side === 'project') return <ProjectSettings />;
  const selected = state.tasks.find((t) => t.id === selectedTaskId);
  if (selected) return <TaskEditor key={selected.id} task={selected} />;
  // Без выбранной задачи главное — последствия черновика, а если его нет — на что обратить внимание.
  return impact ? <ImpactPanel /> : <AttentionPanel />;
}

/** Кнопка сравнения вариантов: появляется, когда есть что сравнивать. */
function VariantsButton() {
  const count = useDraft((s) => s.scenarios.length);
  const setCompareOpen = useDraft((s) => s.setCompareOpen);
  if (count === 0) return null;
  return (
    <Tooltip content="Сравнить сохранённые варианты" describe={false}>
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0 px-2"
        onClick={() => setCompareOpen(true)}
        aria-label={`Сравнить варианты: ${count}`}
      >
        <Columns3 size={15} />
        <span className="hidden xl:inline">Варианты</span>
        <span className="rounded-md bg-sunken px-1.5 text-[12px] leading-5 text-ink-2">
          {count}
        </span>
      </Button>
    </Tooltip>
  );
}

/**
 * Закреплённая панель черновика: коротко — что будет с проектом, и кнопки «Отменить» / «Применить».
 * Полный разбор — по «Подробнее», чтобы редактор задачи не сдвигался при каждой правке.
 */
function DraftBar({ compact, onDetails }: { compact?: boolean; onDetails?: () => void }) {
  const { base, ops, impact, forecast, baseForecast } = useModel();
  const reason = useDraft((s) => s.reason);
  const lastAction = useDraft((s) => s.lastAction);
  const setReason = useDraft((s) => s.setReason);
  const clearDraft = useDraft((s) => s.clearDraft);
  const scenarios = useDraft((s) => s.scenarios);
  const saveScenario = useDraft((s) => s.saveScenario);
  const apply = useApplyChanges(base.project.id);
  const n = ops.length;

  const saved = scenarios.find((s) => sameOps(s.ops, ops));
  const v = impact ? VERDICT[impact.verdict] : null;

  const save = () => {
    const full = scenarios.length >= SCENARIO_LETTERS.length;
    const letter = saveScenario({
      id: newId(),
      name: lastAction || reason.trim() || summarizeOps(base, ops, 1),
      ops,
    });
    toast(
      full
        ? `Сохранено как вариант ${letter}, самый старый вариант удалён`
        : `Сохранено как вариант ${letter}. Отмените черновик и соберите следующий или сравните`,
      'success',
    );
  };

  return (
    <div
      className={cx(
        'shrink-0 border-t border-line bg-surface px-4 pt-3 pb-4 md:px-5',
        !compact && 'animate-toast-in',
      )}
    >
      <div className="flex items-center gap-2">
        {v && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: v.color }} />}
        <p
          className="min-w-0 flex-1 truncate text-[13px] font-semibold"
          style={{ color: v?.color }}
        >
          {v?.title ?? 'Черновик'}
        </p>
        <Tooltip content="Сохранить черновик, чтобы сравнить с другими вариантами" describe={false}>
          <button
            type="button"
            onClick={save}
            disabled={saved !== undefined}
            aria-label={saved ? `Сохранён как вариант ${saved.letter}` : 'Сохранить в варианты'}
            className="-my-1 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:bg-sunken hover:text-ink active:bg-pressed disabled:text-ink-3 disabled:hover:bg-transparent"
          >
            <BookmarkPlus size={14} />
            {saved ? `Вариант ${saved.letter}` : 'В варианты'}
          </button>
        </Tooltip>
      </div>

      {impact && (
        <dl className="mt-2 grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 gap-y-0.5 text-[13px]">
          <dt className="text-ink-3">Финиш</dt>
          <dd>
            {fmtDate(impact.finishBefore)} → {fmtDate(impact.finishAfter)}
            {impact.finishDelta !== 0 && (
              <span
                className={cx(
                  'ml-1.5 font-semibold',
                  impact.finishDelta > 0 ? 'text-crimson' : 'text-moss',
                )}
              >
                {fmtDays(impact.finishDelta, true)}
              </span>
            )}
          </dd>
          {onDetails ? (
            <dd className="row-span-2 self-center">
              <button
                type="button"
                onClick={onDetails}
                className="rounded-md px-1.5 py-1 text-[13px] font-medium text-cobalt transition-colors duration-150 hover:bg-cobalt-soft active:bg-cobalt-soft"
              >
                Подробнее
              </button>
            </dd>
          ) : (
            <dd className="row-span-2" />
          )}
          <dt className="text-ink-3">Шанс успеть</dt>
          <dd>
            {fmtChance(baseForecast.chance)} → {fmtChance(forecast.chance)}
          </dd>
        </dl>
      )}
      <p className="mt-1 text-[12px] leading-4 text-ink-3">
        {n} {plural(n, 'изменение', 'изменения', 'изменений')} в черновике, план ещё не изменён
      </p>

      {!compact && (
        <input
          className={inputClass + ' mt-3'}
          placeholder="Причина, например «подрядчик сдвинул старт»"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="Причина изменения для журнала"
        />
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={clearDraft} className="flex-1">
          <Undo2 size={15} /> Отменить
        </Button>
        <Button
          variant="primary"
          className="flex-[2]"
          disabled={apply.isPending}
          onClick={() => apply.mutate({ ops, reason: reason.trim() || undefined })}
        >
          <Check size={15} /> {apply.isPending ? 'Применяем…' : 'Применить'}
        </Button>
      </div>
    </div>
  );
}
