import type { Dependency, Task } from './types';

export class CycleError extends Error {
  constructor(public readonly taskIds: string[]) {
    super('Зависимости образуют цикл');
  }
}

export interface Adjacency {
  preds: Map<string, Dependency[]>;
  succs: Map<string, Dependency[]>;
}

export function buildAdjacency(tasks: Task[], deps: Dependency[]): Adjacency {
  const preds = new Map<string, Dependency[]>();
  const succs = new Map<string, Dependency[]>();
  for (const t of tasks) {
    preds.set(t.id, []);
    succs.set(t.id, []);
  }
  for (const d of deps) {
    if (!preds.has(d.successorId) || !succs.has(d.predecessorId)) continue;
    preds.get(d.successorId)!.push(d);
    succs.get(d.predecessorId)!.push(d);
  }
  return { preds, succs };
}

/**
 * Топологическая сортировка (Kahn). При равенстве сохраняет порядок задач (sortOrder),
 * чтобы результат был стабильным. Бросает CycleError с задачами, попавшими в цикл.
 */
export function topoSort(tasks: Task[], adj: Adjacency): string[] {
  const sorted = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);
  const rank = new Map(sorted.map((t, i) => [t.id, i]));
  const indeg = new Map<string, number>();
  for (const t of sorted) indeg.set(t.id, adj.preds.get(t.id)!.length);

  const ready = sorted.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => rank.get(a)! - rank.get(b)!);
    const id = ready.shift()!;
    order.push(id);
    for (const d of adj.succs.get(id)!) {
      const left = indeg.get(d.successorId)! - 1;
      indeg.set(d.successorId, left);
      if (left === 0) ready.push(d.successorId);
    }
  }
  if (order.length !== sorted.length) {
    const remaining = new Set(sorted.filter((t) => indeg.get(t.id)! > 0).map((t) => t.id));
    throw new CycleError(findCycle(remaining, adj) ?? [...remaining]);
  }
  return order;
}

/** Ищет конкретный цикл среди вершин, не прошедших топосортировку (DFS с цветами). */
function findCycle(nodes: Set<string>, adj: Adjacency): string[] | null {
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    state.set(id, 1);
    stack.push(id);
    for (const d of adj.succs.get(id)!) {
      const next = d.successorId;
      if (!nodes.has(next)) continue;
      if (state.get(next) === 1) return [...stack.slice(stack.indexOf(next)), next];
      if (!state.has(next)) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of nodes) {
    if (!state.has(id)) {
      const found = visit(id);
      if (found) return found;
    }
  }
  return null;
}

/** Все транзитивные последователи задачи. */
export function descendants(taskId: string, adj: Adjacency): Set<string> {
  const seen = new Set<string>();
  const stack = [taskId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const d of adj.succs.get(id) ?? []) {
      if (!seen.has(d.successorId)) {
        seen.add(d.successorId);
        stack.push(d.successorId);
      }
    }
  }
  return seen;
}
