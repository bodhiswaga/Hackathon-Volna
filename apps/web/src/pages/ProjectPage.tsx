import { lazy, Suspense, useEffect, useRef } from 'react';
import { ArrowLeft, Plus, RotateCcw } from 'lucide-react';
import { useProject, useResetDemo } from '../api/hooks';
import { AdvisorPanel } from '../components/advisor/AdvisorPanel';
import { AttentionPanel } from '../components/AttentionPanel';
import { GanttView } from '../components/gantt/GanttView';
import { ImpactPanel } from '../components/impact/ImpactPanel';
import { JournalView } from '../components/JournalView';
import { StatusStrip } from '../components/StatusStrip';
import { TaskTable } from '../components/table/TaskTable';
import { TaskEditor } from '../components/task/TaskEditor';
import { TeamView } from '../components/TeamView';
import { Button, cx, Empty, WaveMark } from '../components/ui';
import { fmtDate, newId } from '../lib/format';
import { ModelContext, useModel, usePropose, useProjectModel } from '../lib/model';
import { navigate } from '../lib/router';
import { useDraft, type ViewTab } from '../store/draft';

// Граф (React Flow + dagre) — самая тяжёлая часть бандла, грузим его только при открытии вкладки.
const GraphView = lazy(() =>
  import('../components/graph/GraphView').then((m) => ({ default: m.GraphView })),
);

const TABS: { id: ViewTab; label: string }[] = [
  { id: 'timeline', label: 'Таймлайн' },
  { id: 'graph', label: 'Граф связей' },
  { id: 'table', label: 'Задачи' },
  { id: 'journal', label: 'Журнал' },
  { id: 'team', label: 'Команда' },
];

export function ProjectPage({ id }: { id: string }) {
  const { data, isLoading, error } = useProject(id);
  const openProject = useDraft((s) => s.openProject);
  useEffect(() => openProject(id), [id, openProject]);
  const model = useProjectModel(data);

  if (isLoading) return <p className="p-10 text-ink-3">Загружаем проект…</p>;
  if (error || !model) {
    return (
      <Empty title="Проект не открылся">
        {error?.message ?? 'Нет данных'}.{' '}
        <button className="text-cobalt underline" onClick={() => navigate('/')}>
          К списку проектов
        </button>
      </Empty>
    );
  }

  return (
    <ModelContext.Provider value={model}>
      <div className="flex h-full flex-col">
        <TopBar />
        <StatusStrip />
        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col">
            <Tabs />
            <div className="min-h-0 flex-1 overflow-auto">
              <CurrentView />
            </div>
          </main>
          <SideColumn />

        </div>
      </div>
    </ModelContext.Provider>
  );
}

function TopBar() {
  const { state } = useModel();
  const reset = useResetDemo();
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-6">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="flex items-center gap-2 rounded-lg pr-2 text-ink-2 hover:text-ink"
        aria-label="К списку проектов"
      >
        <ArrowLeft size={16} />
        <WaveMark size={24} />
      </button>
      <div className="min-w-0">
        <h1 className="truncate font-semibold leading-5">{state.project.name}</h1>
        <p className="text-[12px] text-ink-3">
          {fmtDate(state.project.startDate)} — {fmtDate(state.project.deadline)}
          {state.project.description && `. ${state.project.description}`}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {state.project.id === 'demo' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm('Пересоздать демо-проект? Все изменения и журнал будут сброшены.')) reset.mutate();
            }}
          >
            <RotateCcw size={14} /> Сбросить демо
          </Button>
        )}
      </div>
    </header>
  );
}

function Tabs() {
  const { tab, setTab, select } = useDraft();
  const { state } = useModel();
  const propose = usePropose();

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
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-surface px-4">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTab(t.id)}
          className={cx(
            'relative h-12 px-3 text-sm font-medium transition-colors',
            tab === t.id ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {t.label}
          {tab === t.id && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-ink" />}
        </button>
      ))}
      <Button variant="primary" size="sm" className="ml-auto" onClick={addTask}>
        <Plus size={14} /> Задача
      </Button>
    </div>
  );
}

function CurrentView() {
  const tab = useDraft((s) => s.tab);
  switch (tab) {
    case 'timeline':
      return <GanttView />;
    case 'graph':
      return (
        <Suspense fallback={<p className="p-6 text-sm text-ink-3">Загружаем граф…</p>}>
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
  const ref = useRef<HTMLElement>(null);
  const hasDraft = useDraft((s) => s.ops.length > 0);
  const side = useDraft((s) => s.side);
  // Когда появляется черновик или открывается советник — показываем панель с начала.
  useEffect(() => {
    if (hasDraft || side === 'advisor') ref.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [hasDraft, side]);
  return (
    <aside ref={ref} className="w-[420px] shrink-0 overflow-y-auto border-l border-line bg-surface">
      <SidePanel />
    </aside>
  );
}

function SidePanel() {
  const { side, selectedTaskId } = useDraft();
  const { impact, state } = useModel();
  if (side === 'advisor') return <AdvisorPanel />;
  const selected = state.tasks.find((t) => t.id === selectedTaskId);
  return (
    <div className="divide-y divide-line">
      {impact && <ImpactPanel />}
      {selected ? <TaskEditor key={selected.id} task={selected} /> : !impact && <AttentionPanel />}
    </div>
  );
}
