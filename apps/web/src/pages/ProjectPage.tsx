import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BookmarkPlus,
  ChartGantt,
  Check,
  ChevronDown,
  Columns3,
  FolderOpen,
  History,
  Plus,
  Radar,
  RotateCcw,
  Settings2,
  Table2,
  Undo2,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { plural, summarizeOps } from '@volna/engine';
import { useApplyChanges, useProject, useResetDemo } from '../api/hooks';
import { AdvisorPanel } from '../components/advisor/AdvisorPanel';
import { AttentionPanel } from '../components/AttentionPanel';
import { EventHost, EventsMenu } from '../components/events/EventDialog';
import { GanttView } from '../components/gantt/GanttView';
import { ImpactPanel } from '../components/impact/ImpactPanel';
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
  Skeleton,
  WaveMark,
} from '../components/ui';
import { fmtDate, newId } from '../lib/format';
import { ModelContext, useModel, usePropose, useProjectModel } from '../lib/model';
import { navigate } from '../lib/router';
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

const TABS: { id: ViewTab; label: string; icon: LucideIcon }[] = [
  { id: 'timeline', label: 'Таймлайн', icon: ChartGantt },
  { id: 'risks', label: 'Риски', icon: Radar },
  { id: 'graph', label: 'Граф связей', icon: Workflow },
  { id: 'table', label: 'Задачи', icon: Table2 },
  { id: 'team', label: 'Команда', icon: Users },
  { id: 'journal', label: 'Журнал', icon: History },
];

export function ProjectPage({ id }: { id: string }) {
  const { data, isLoading, error } = useProject(id);
  const openProject = useDraft((s) => s.openProject);
  useEffect(() => openProject(id), [id, openProject]);
  const model = useProjectModel(data);

  if (isLoading) return <ProjectSkeleton />;
  if (error || !model) {
    return (
      <Empty
        title="Проект не открылся"
        action={
          <Button variant="primary" onClick={() => navigate('/')}>
            К списку проектов
          </Button>
        }
      >
        {error?.message ?? 'Нет данных'}
      </Empty>
    );
  }

  return (
    <ModelContext.Provider value={model}>
      <div className="flex h-full flex-col">
        <TopBar />
        <StatusStrip />
        <div className="flex min-h-0 flex-1">
          <MainView />
          <SideColumn />
        </div>
      </div>
      <EventHost />
      <CompareHost />
    </ModelContext.Provider>
  );
}

function ProjectSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-3 border-b border-line bg-surface px-4">
        <WaveMark />
        <Skeleton className="h-5 w-64" />
        <Skeleton className="ml-auto h-8 w-96" />
      </div>
      <div className="h-[84px] bg-ink" />
      <div className="flex-1 space-y-3 p-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-7" />
        ))}
      </div>
    </div>
  );
}

function TopBar() {
  const { state } = useModel();
  const reset = useResetDemo();
  const setSide = useDraft((s) => s.setSide);
  const select = useDraft((s) => s.select);
  const propose = usePropose();
  const isDemo = state.project.id === 'demo';

  const addTask = () => {
    const id = newId();
    const ok = propose({
      type: 'createTask',
      task: {
        id,
        projectId: state.project.id,
        name: `Задача ${state.tasks.length + 1}`,
        description: '',
        durationDays: 3,
        status: 'not_started',
        assigneeId: null,
        dueDate: null,
        startNotEarlier: null,
        actualStart: null,
        actualEnd: null,
        sortOrder: Math.max(0, ...state.tasks.map((t) => t.sortOrder)) + 1,
      },
    });
    if (ok) select(id);
  };

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 xl:px-4">
      <a
        href="#/"
        className="flex shrink-0 items-center gap-2 rounded-xl p-1 transition-colors hover:bg-ink/5 xl:pr-2.5"
        aria-label="Все проекты"
        title="Все проекты"
      >
        <WaveMark />
        <span className="hidden font-display font-semibold xl:inline">Волна</span>
      </a>
      <span className="text-line" aria-hidden>
        /
      </span>

      <Popover
        label="Меню проекта"
        buttonClassName="flex max-w-[200px] min-w-0 items-center gap-2 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-ink/5 aria-expanded:bg-ink/5 xl:max-w-[280px] 2xl:max-w-[440px]"
        button={(open) => (
          <>
            <span className="min-w-0">
              <span className="block truncate text-[14px] leading-5 font-semibold">
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
        panelClassName="w-80"
      >
        {(close) => (
          <>
            {state.project.description && (
              <p className="px-3 pt-2 pb-2.5 text-[13px] leading-snug text-ink-2">
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
            <div className="mx-3 my-1 border-t border-line/70" />
            <MenuItem icon={<FolderOpen size={16} />} onClick={() => navigate('/')}>
              Все проекты
            </MenuItem>
          </>
        )}
      </Popover>

      <Tabs />

      <VariantsButton />
      <EventsMenu />
      <Button
        variant="primary"
        size="sm"
        className="h-8 shrink-0 px-2.5 xl:px-3"
        onClick={addTask}
        aria-label="Новая задача"
      >
        <Plus size={15} /> <span className="hidden xl:inline">Задача</span>
      </Button>
    </header>
  );
}

function Tabs() {
  const tab = useDraft((s) => s.tab);
  const setTab = useDraft((s) => s.setTab);
  const listRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  // Подложка активной вкладки переезжает к выбранной — видно, куда переключились.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const el = list.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [tab]);

  return (
    <nav
      ref={listRef}
      role="tablist"
      aria-label="Представление проекта"
      className="relative mx-auto flex shrink-0 rounded-xl bg-ink/[0.05] p-1"
    >
      {pill && (
        <span
          aria-hidden
          className="absolute top-1 bottom-1 rounded-lg bg-surface shadow-raised transition-[left,width] duration-300 ease-[var(--ease-out-soft)]"
          style={{ left: pill.left, width: pill.width }}
        />
      )}
      {TABS.map((t) => (
        <button
          key={t.id}
          data-tab={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => setTab(t.id)}
          className={cx(
            'relative flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] xl:px-3 font-medium transition-colors',
            tab === t.id ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          <t.icon size={15} className="hidden 2xl:block" />
          {t.label}
        </button>
      ))}
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

function CurrentView({ tab }: { tab: ViewTab }) {
  switch (tab) {
    case 'timeline':
      return <GanttView />;
    case 'risks':
      return <RisksView />;
    case 'graph':
      return (
        <Suspense fallback={<Skeleton className="m-6 h-[420px]" />}>
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

function SideColumn() {
  const ref = useRef<HTMLDivElement>(null);
  const hasDraft = useDraft((s) => s.ops.length > 0);
  const side = useDraft((s) => s.side);
  const selectedTaskId = useDraft((s) => s.selectedTaskId);
  // Когда появляется черновик или открывается советник — показываем панель с начала.
  useEffect(() => {
    if (hasDraft || side === 'advisor') ref.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [hasDraft, side]);
  return (
    <aside className="w-[360px] shrink-0 border-l border-line bg-surface xl:w-[420px]">
      <div ref={ref} className="flex h-full flex-col overflow-y-auto">
        <div key={`${side}:${selectedTaskId ?? ''}`} className="animate-view-in flex-1">
          <SidePanel />
        </div>
        {hasDraft && <DraftBar />}
      </div>
    </aside>
  );
}

function SidePanel() {
  const side = useDraft((s) => s.side);
  const selectedTaskId = useDraft((s) => s.selectedTaskId);
  const { impact, state } = useModel();
  if (side === 'advisor') return <AdvisorPanel />;
  if (side === 'project') {
    return (
      <div className="divide-y divide-line">
        {impact && <ImpactPanel />}
        <ProjectSettings />
      </div>
    );
  }
  const selected = state.tasks.find((t) => t.id === selectedTaskId);
  return (
    <div className="divide-y divide-line">
      {impact && <ImpactPanel />}
      {selected ? <TaskEditor key={selected.id} task={selected} /> : !impact && <AttentionPanel />}
    </div>
  );
}

/** Кнопка сравнения вариантов: появляется, когда есть что сравнивать. */
function VariantsButton() {
  const count = useDraft((s) => s.scenarios.length);
  const setCompareOpen = useDraft((s) => s.setCompareOpen);
  if (count === 0) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-8 shrink-0"
      onClick={() => setCompareOpen(true)}
      title="Сравнить сохранённые варианты"
      aria-label={`Сравнить варианты: ${count}`}
    >
      <Columns3 size={15} />
      <span className="hidden 2xl:inline">Варианты ·</span> {count}
    </Button>
  );
}

/** Закреплённая панель черновика: применить или отменить можно из любого места боковой колонки. */
function DraftBar() {
  const { base, ops } = useModel();
  const reason = useDraft((s) => s.reason);
  const lastAction = useDraft((s) => s.lastAction);
  const setReason = useDraft((s) => s.setReason);
  const clearDraft = useDraft((s) => s.clearDraft);
  const scenarios = useDraft((s) => s.scenarios);
  const saveScenario = useDraft((s) => s.saveScenario);
  const apply = useApplyChanges(base.project.id);
  const n = ops.length;
  const saved = scenarios.find((s) => sameOps(s.ops, ops));

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
        : `Сохранено как вариант ${letter}. Отмените черновик и соберите следующий — или сравните`,
      'success',
    );
  };

  return (
    <div className="glass animate-toast-in sticky bottom-0 z-10 border-t border-line/80 px-5 pt-3 pb-4">
      <div className="flex items-center gap-2 text-[12px] text-ink-2">
        <span className="h-2 w-2 shrink-0 rounded-full bg-wave" />
        <span className="flex-1">
          Черновик: {n} {plural(n, 'изменение', 'изменения', 'изменений')}, план ещё не изменён
        </span>
        <button
          type="button"
          onClick={save}
          disabled={saved !== undefined}
          title="Сохранить черновик, чтобы сравнить с другими вариантами"
          className="-my-1 inline-flex items-center gap-1 rounded-lg px-1.5 py-1 font-medium text-ink-2 transition-colors hover:bg-ink/5 hover:text-ink disabled:text-ink-3 disabled:hover:bg-transparent"
        >
          <BookmarkPlus size={14} />
          {saved ? `Вариант ${saved.letter}` : 'В варианты'}
        </button>
      </div>
      <input
        className={inputClass + ' mt-2.5 bg-surface/80'}
        placeholder="Причина, например «подрядчик сдвинул старт»"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-label="Причина изменения"
      />
      <div className="mt-2.5 flex gap-2">
        <Button variant="secondary" onClick={clearDraft} className="flex-1">
          <Undo2 size={15} /> Отменить
        </Button>
        <Button
          variant="primary"
          className="flex-[2]"
          disabled={apply.isPending}
          onClick={() => apply.mutate({ ops, reason: reason.trim() || undefined })}
        >
          <Check size={15} /> Применить изменения
        </Button>
      </div>
    </div>
  );
}
