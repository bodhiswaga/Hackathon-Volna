import { memo, useMemo, useState } from 'react';
import dagre from '@dagrejs/dagre';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Cable, Plus, Trash2, X } from 'lucide-react';
import type { Person, Task, TaskImpact, TaskSchedule } from '@volna/engine';
import { fmtDays, fmtRange, newId, STATUS_LABEL } from '../../lib/format';
import { useAddTask, useModel, usePropose, useRecalcFlash } from '../../lib/model';
import { toast, useDraft } from '../../store/draft';
import { Avatar, Button, cx, Empty, IconButton, StatusIcon } from '../ui';

const NODE_W = 232;
const NODE_H = 74;
const HINT_KEY = 'volna:graph-hint-hidden';

type TaskNodeData = {
  task: Task;
  sched: TaskSchedule;
  person: Person | null;
  impact: TaskImpact | undefined;
  selected: boolean;
  dimmed: boolean;
  flashKey: number;
};
type TaskNodeType = Node<TaskNodeData, 'task'>;

const TaskNode = memo(function TaskNode({ data }: NodeProps<TaskNodeType>) {
  const { task, sched, person, impact, selected, dimmed, flashKey } = data;
  const shifted = impact && (impact.deltaEnd !== 0 || impact.created);
  const crit = sched.flags.critical;
  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-lg border bg-surface px-3 py-1.5 transition-[border-color,opacity] duration-150',
        shifted && 'wave-in',
        selected
          ? 'border-2 border-cobalt'
          : crit
            ? 'border-[1.5px] border-crimson'
            : shifted
              ? 'border-wave'
              : 'border-line-strong',
      )}
      style={{
        width: NODE_W,
        height: NODE_H,
        opacity: dimmed ? 0.45 : 1,
        background: shifted
          ? 'var(--color-wave-soft)'
          : task.status === 'done'
            ? 'var(--color-paper)'
            : undefined,
        animationDelay: impact ? `${(impact.chain.length - 1) * 60}ms` : undefined,
      }}
    >
      {flashKey > 0 && (
        <span key={flashKey} aria-hidden className="recalc-flash absolute inset-0 bg-wave/15" />
      )}
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2.5 !w-2.5 !border-2 !border-surface !bg-ink-3"
      />
      <div className="relative flex items-center gap-1.5">
        <StatusIcon status={task.status} size={15} />
        <span
          className={cx(
            'min-w-0 flex-1 truncate text-[13px] font-semibold',
            task.status === 'done' && 'text-ink-3',
          )}
          title={task.name}
        >
          {task.name}
        </span>
      </div>
      <p className="relative mt-0.5 text-[12px] text-ink-2">
        {fmtRange(sched.startDate, sched.endDate)}
        {task.durationDays === 0 && ', веха'}
      </p>
      <div className="relative mt-1 flex items-center gap-1.5">
        <Avatar person={person} size={18} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">
          {person?.name ?? 'не назначен'}
        </span>
        {shifted && impact.deltaEnd !== 0 ? (
          <span className="rounded-md bg-surface px-1.5 text-[11px] font-bold text-wave-deep">
            {fmtDays(impact.deltaEnd, true)}
          </span>
        ) : task.status !== 'done' ? (
          <span className={cx('text-[11px] font-medium', crit ? 'text-crimson' : 'text-ink-3')}>
            {crit ? 'без резерва' : `резерв ${fmtDays(sched.float)}`}
          </span>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2.5 !w-2.5 !border-2 !border-surface !bg-ink-3"
      />
    </div>
  );
});

const nodeTypes = { task: TaskNode };

function readHintHidden(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function GraphView() {
  const { state, analysis: a, impact } = useModel();
  const selectedId = useDraft((s) => s.selectedTaskId);
  const select = useDraft((s) => s.select);
  const propose = usePropose();
  const addTask = useAddTask();
  const flash = useRecalcFlash(a);
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hintHidden, setHintHidden] = useState(readHintHidden);

  // Раскладка зависит только от структуры графа, а не от дат.
  const structureKey =
    state.tasks.map((t) => t.id).join(',') +
    '|' +
    state.dependencies.map((d) => `${d.predecessorId}>${d.successorId}`).join(',');
  const positions = useMemo(() => {
    const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'TB', ranksep: 30, nodesep: 28, marginx: 10, marginy: 10 });
    for (const t of state.tasks) g.setNode(t.id, { width: NODE_W, height: NODE_H });
    for (const d of state.dependencies) g.setEdge(d.predecessorId, d.successorId);
    dagre.layout(g);
    return new Map(
      state.tasks.map((t) => {
        const p = g.node(t.id);
        return [t.id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 }];
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey]);

  // Задача под курсором и её соседи по связям: остальное приглушается.
  const linked = useMemo(() => {
    if (!hoverId) return null;
    const ids = new Set([hoverId]);
    const deps = new Set<string>();
    for (const d of state.dependencies) {
      if (d.predecessorId === hoverId || d.successorId === hoverId) {
        ids.add(d.predecessorId);
        ids.add(d.successorId);
        deps.add(d.id);
      }
    }
    return { ids, deps };
  }, [hoverId, state.dependencies]);

  const nodes = useMemo<TaskNodeType[]>(() => {
    const affected = new Map((impact?.affected ?? []).map((x) => [x.taskId, x]));
    const peopleById = new Map(state.people.map((p) => [p.id, p]));
    return state.tasks.map((t) => ({
      id: t.id,
      type: 'task',
      position: positions.get(t.id) ?? { x: 0, y: 0 },
      draggable: false,
      // Узлы пересоздаются при наведении и правках; без заданного размера React Flow
      // сбрасывает замер и не рисует связи, пока узел не изменит размер.
      measured: { width: NODE_W, height: NODE_H },
      ariaLabel: `${t.name}, ${STATUS_LABEL[t.status]}`,
      data: {
        task: t,
        sched: a.tasks[t.id],
        person: t.assigneeId ? (peopleById.get(t.assigneeId) ?? null) : null,
        impact: affected.get(t.id),
        selected: selectedId === t.id,
        dimmed: linked !== null && !linked.ids.has(t.id),
        flashKey: flash.ids.has(t.id) ? flash.stamp : 0,
      },
    }));
  }, [state.tasks, state.people, positions, a, impact, selectedId, linked, flash]);

  const edges = useMemo<Edge[]>(() => {
    const affected = new Set((impact?.affected ?? []).map((x) => x.taskId));
    const critDeps = new Set(a.criticalDependencyIds);
    return state.dependencies.map((d) => {
      const drv = a.tasks[d.successorId]?.driver;
      const wave =
        affected.has(d.successorId) && drv?.kind === 'dependency' && drv.dependencyId === d.id;
      const hot = edgeId === d.id || (linked?.deps.has(d.id) ?? false);
      const color = hot
        ? 'var(--color-ink)'
        : wave
          ? 'var(--color-wave)'
          : critDeps.has(d.id)
            ? 'var(--color-crimson)'
            : 'var(--color-idle)';
      return {
        id: d.id,
        source: d.predecessorId,
        target: d.successorId,
        type: 'smoothstep',
        animated: wave,
        ariaLabel: 'Связь между задачами',
        label:
          d.lagDays > 0
            ? `пауза ${fmtDays(d.lagDays)}`
            : d.lagDays < 0
              ? `нахлёст ${fmtDays(-d.lagDays)}`
              : undefined,
        labelStyle: { fontSize: 11, fill: 'var(--color-ink-2)' },
        labelBgStyle: { fill: 'var(--color-surface)' },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
        style: {
          stroke: color,
          strokeWidth: hot || wave || critDeps.has(d.id) ? 2 : 1.25,
          opacity: linked && !hot ? 0.2 : 1,
          transition: 'opacity 150ms ease-out',
        },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      };
    });
  }, [state.dependencies, a, impact, edgeId, linked]);

  if (state.tasks.length === 0) {
    return (
      <Empty
        title="Граф пока пуст"
        action={
          <Button variant="primary" onClick={addTask}>
            <Plus size={16} /> Добавить задачу
          </Button>
        }
      >
        Добавьте задачи, затем протяните линию от нижней точки одной задачи к верхней точке другой.
      </Empty>
    );
  }

  const onConnect = (c: Connection) => {
    if (!c.source || !c.target) return;
    propose({
      type: 'addDependency',
      dependency: {
        id: newId(),
        projectId: state.project.id,
        predecessorId: c.source,
        successorId: c.target,
        lagDays: 0,
      },
    });
  };

  const hideHint = () => {
    setHintHidden(true);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // Хранилище недоступно — подсказка просто вернётся при следующем открытии.
    }
  };

  const selectedEdge = state.dependencies.find((d) => d.id === edgeId);
  const nameOf = (id: string) => state.tasks.find((t) => t.id === id)?.name;

  return (
    <div className="h-full min-h-[480px] w-full">
      <ReactFlow
        key={structureKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onConnect={onConnect}
        onNodeClick={(_, n) => {
          setEdgeId(null);
          select(n.id);
        }}
        onNodeMouseEnter={(_, n) => setHoverId(n.id)}
        onNodeMouseLeave={() => setHoverId(null)}
        onEdgeClick={(_, e) => setEdgeId(e.id)}
        onPaneClick={() => setEdgeId(null)}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.3}
        nodesConnectable
        attributionPosition="top-right"
      >
        <Background gap={24} size={1.2} color="var(--color-line)" />
        <Controls showInteractive={false} />
        {!hintHidden && !selectedEdge && (
          <Panel position="bottom-right">
            <div className="flex max-w-xs items-start gap-2 rounded-lg border border-line bg-surface py-2 pr-1 pl-3 text-[13px] leading-snug text-ink-2 shadow-float">
              <Cable size={14} className="mt-0.5 shrink-0 text-ink-3" />
              <p>
                Связь: протяните линию от нижней точки задачи к верхней точке другой. Чтобы убрать
                связь, нажмите на неё.
              </p>
              <IconButton label="Скрыть подсказку" className="-my-1 h-7 w-7" onClick={hideHint}>
                <X size={14} />
              </IconButton>
            </div>
          </Panel>
        )}
        {selectedEdge && (
          <Panel position="bottom-center">
            <div className="animate-toast-in flex items-center gap-3 rounded-lg bg-ink py-2 pr-2 pl-4 text-sm text-white shadow-float">
              <span>
                «{nameOf(selectedEdge.predecessorId)}» → «{nameOf(selectedEdge.successorId)}»
              </span>
              <Button
                size="sm"
                variant="danger-solid"
                onClick={() => {
                  const before = useDraft.getState().ops;
                  if (propose({ type: 'removeDependency', dependencyId: selectedEdge.id })) {
                    toast('Связь убрана', 'info', {
                      action: {
                        label: 'Отменить',
                        onClick: () => useDraft.getState().setOps(before),
                      },
                    });
                  }
                  setEdgeId(null);
                }}
              >
                <Trash2 size={13} /> Убрать связь
              </Button>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
