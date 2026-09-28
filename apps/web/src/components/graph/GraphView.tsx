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
import { Cable, Flame, Trash2 } from 'lucide-react';
import type { Person, Task, TaskImpact, TaskSchedule } from '@volna/engine';
import { fmtDate, fmtDays, newId, STATUS_COLOR, STATUS_LABEL } from '../../lib/format';
import { useModel, usePropose } from '../../lib/model';
import { useDraft } from '../../store/draft';
import { Avatar, Button, cx, Empty } from '../ui';

const NODE_W = 232;
const NODE_H = 74;

type TaskNodeData = {
  task: Task;
  sched: TaskSchedule;
  person: Person | null;
  impact: TaskImpact | undefined;
  selected: boolean;
};
type TaskNodeType = Node<TaskNodeData, 'task'>;

const TaskNode = memo(function TaskNode({ data }: NodeProps<TaskNodeType>) {
  const { task, sched, person, impact, selected } = data;
  const shifted = impact && (impact.deltaEnd !== 0 || impact.created);
  const crit = sched.flags.critical;
  return (
    <div
      className={cx(
        'rounded-2xl border-2 bg-surface px-3 py-1.5 shadow-[0_1px_2px_rgb(18_29_51/0.05),0_6px_16px_-8px_rgb(18_29_51/0.2)] transition-[border-color,box-shadow]',
        shifted && 'wave-in',
        selected ? 'border-ink' : shifted ? 'border-wave' : crit ? 'border-crimson' : 'border-line',
      )}
      style={{
        width: NODE_W,
        height: NODE_H,
        background: shifted ? 'var(--color-wave-soft)' : task.status === 'done' ? '#f6f8fb' : undefined,
        animationDelay: impact ? `${(impact.chain.length - 1) * 110}ms` : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} className="!h-3 !w-3 !border-2 !border-surface !bg-ink-3" />
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[task.status] }} title={STATUS_LABEL[task.status]} />
        <span className={cx('min-w-0 flex-1 truncate text-[13px] font-semibold', task.status === 'done' && 'text-ink-3')} title={task.name}>
          {task.name}
        </span>
        {crit && <Flame size={13} className="shrink-0 text-crimson" />}
      </div>
      <p className="mt-0.5 text-[12px] text-ink-2">
        {fmtDate(sched.startDate)} — {fmtDate(sched.endDate)}
        {task.durationDays === 0 && ', веха'}
      </p>
      <div className="mt-1 flex items-center gap-1.5">
        <Avatar person={person} size={18} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{person?.name ?? 'не назначен'}</span>
        {shifted && impact.deltaEnd !== 0 ? (
          <span className="rounded-full bg-wave px-2 text-[11px] font-bold text-white">{fmtDays(impact.deltaEnd, true)}</span>
        ) : task.status !== 'done' ? (
          <span className={cx('text-[11px] font-medium', crit ? 'text-crimson' : 'text-ink-3')}>
            {crit ? 'без резерва' : `резерв ${fmtDays(sched.float)}`}
          </span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-3 !w-3 !border-2 !border-surface !bg-ink-3" />
    </div>
  );
});

const nodeTypes = { task: TaskNode };

export function GraphView() {
  const { state, analysis: a, impact } = useModel();
  const selectedId = useDraft((s) => s.selectedTaskId);
  const select = useDraft((s) => s.select);
  const propose = usePropose();
  const [edgeId, setEdgeId] = useState<string | null>(null);

  // Раскладка зависит только от структуры графа, а не от дат.
  const structureKey =
    state.tasks.map((t) => t.id).join(',') + '|' + state.dependencies.map((d) => `${d.predecessorId}>${d.successorId}`).join(',');
  const positions = useMemo(() => {
    const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'TB', ranksep: 30, nodesep: 28, marginx: 10, marginy: 10 });
    for (const t of state.tasks) g.setNode(t.id, { width: NODE_W, height: NODE_H });
    for (const d of state.dependencies) g.setEdge(d.predecessorId, d.successorId);
    dagre.layout(g);
    return new Map(state.tasks.map((t) => {
      const p = g.node(t.id);
      return [t.id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 }];
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey]);

  const affected = new Map((impact?.affected ?? []).map((x) => [x.taskId, x]));
  const critDeps = new Set(a.criticalDependencyIds);
  const peopleById = new Map(state.people.map((p) => [p.id, p]));

  const nodes: TaskNodeType[] = state.tasks.map((t) => ({
    id: t.id,
    type: 'task',
    position: positions.get(t.id) ?? { x: 0, y: 0 },
    draggable: false,
    data: {
      task: t,
      sched: a.tasks[t.id],
      person: t.assigneeId ? (peopleById.get(t.assigneeId) ?? null) : null,
      impact: affected.get(t.id),
      selected: selectedId === t.id,
    },
  }));

  const edges: Edge[] = state.dependencies.map((d) => {
    const drv = a.tasks[d.successorId]?.driver;
    const wave = affected.has(d.successorId) && drv?.kind === 'dependency' && drv.dependencyId === d.id;
    const color = edgeId === d.id ? '#121d33' : wave ? '#fa6a1f' : critDeps.has(d.id) ? '#df3350' : '#b3bccb';
    return {
      id: d.id,
      source: d.predecessorId,
      target: d.successorId,
      type: 'smoothstep',
      animated: wave,
      label: d.lagDays > 0 ? `пауза ${fmtDays(d.lagDays)}` : d.lagDays < 0 ? `нахлёст ${fmtDays(-d.lagDays)}` : undefined,
      labelStyle: { fontSize: 11, fill: '#465169' },
      labelBgStyle: { fill: '#ffffff' },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
      style: { stroke: color, strokeWidth: wave || critDeps.has(d.id) || edgeId === d.id ? 2.2 : 1.4 },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    };
  });

  if (state.tasks.length === 0) {
    return <Empty title="Граф пуст">Добавьте задачи, а затем соедините их, протянув линию от нижней точки одной к верхней точке другой.</Empty>;
  }

  const onConnect = (c: Connection) => {
    if (!c.source || !c.target) return;
    propose({
      type: 'addDependency',
      dependency: { id: newId(), projectId: state.project.id, predecessorId: c.source, successorId: c.target, lagDays: 0 },
    });
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
        onEdgeClick={(_, e) => setEdgeId(e.id)}
        onPaneClick={() => setEdgeId(null)}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.3}
        nodesConnectable
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1.4} color="#cfd6e2" />
        <Controls showInteractive={false} />
        <Panel position="bottom-right">
          <p className="glass flex max-w-xs items-start gap-2 rounded-xl border border-line/70 px-3 py-2 text-[12px] leading-snug text-ink-2 shadow-float">
            <Cable size={14} className="mt-px shrink-0 text-ink-3" />
            Протяните линию от нижней точки задачи к верхней точке другой, чтобы добавить связь. Нажмите на связь, чтобы её убрать.
          </p>
        </Panel>
        {selectedEdge && (
          <Panel position="bottom-center">
            <div className="glass-ink animate-toast-in flex items-center gap-3 rounded-2xl py-2 pr-2 pl-4 text-sm text-white shadow-float">
              <span>
                «{nameOf(selectedEdge.predecessorId)}» → «{nameOf(selectedEdge.successorId)}»
              </span>
              <Button
                size="sm"
                variant="danger-solid"
                onClick={() => {
                  propose({ type: 'removeDependency', dependencyId: selectedEdge.id });
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
