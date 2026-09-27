import { createContext, useCallback, useContext, useMemo } from 'react';
import {
  analyze,
  applyChangeSet,
  diffAnalyses,
  mergeOps,
  type Analysis,
  type ChangeOp,
  type ImpactReport,
  type ProjectState,
} from '@volna/engine';
import { toast, useDraft } from '../store/draft';
import { todayISO } from './format';

export interface ProjectModel {
  /** Состояние с сервера. */
  base: ProjectState;
  baseAnalysis: Analysis;
  /** Состояние с учётом черновика (что будет, если применить). */
  state: ProjectState;
  analysis: Analysis;
  impact: ImpactReport | null;
  ops: ChangeOp[];
  today: string;
}

export function useProjectModel(base: ProjectState | undefined): ProjectModel | null {
  const ops = useDraft((s) => s.ops);
  return useMemo(() => {
    if (!base) return null;
    const today = todayISO();
    const baseAnalysis = analyze(base, today);
    if (ops.length === 0) {
      return { base, baseAnalysis, state: base, analysis: baseAnalysis, impact: null, ops, today };
    }
    try {
      const state = applyChangeSet(base, ops);
      const analysis = analyze(state, today);
      const impact = diffAnalyses(base, baseAnalysis, state, analysis, ops);
      return { base, baseAnalysis, state, analysis, impact, ops, today };
    } catch {
      // Черновик устарел относительно сервера (например, после отката) — показываем базу.
      return { base, baseAnalysis, state: base, analysis: baseAnalysis, impact: null, ops: [], today };
    }
  }, [base, ops]);
}

export const ModelContext = createContext<ProjectModel | null>(null);

export function useModel(): ProjectModel {
  const m = useContext(ModelContext);
  if (!m) throw new Error('ModelContext не задан');
  return m;
}

/** Добавить операции в черновик what-if: проверяются движком сразу, ошибка — в тост. */
export function usePropose() {
  const model = useModel();
  const setOps = useDraft((s) => s.setOps);
  return useCallback(
    (...newOps: ChangeOp[]) => {
      let next = useDraft.getState().ops;
      for (const op of newOps) next = mergeOps(next, op);
      try {
        applyChangeSet(model.base, next);
        setOps(next);
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Изменение невозможно', 'error');
        return false;
      }
    },
    [model.base, setOps],
  );
}
