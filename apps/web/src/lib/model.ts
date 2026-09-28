import { createContext, useCallback, useContext, useMemo } from 'react';
import {
  analyze,
  applyChangeSet,
  diffAnalyses,
  forecast,
  mergeOps,
  stressTest,
  type Analysis,
  type ChangeOp,
  type Forecast,
  type ImpactReport,
  type ProjectState,
  type Threat,
} from '@volna/engine';
import { toast, useDraft } from '../store/draft';
import { todayISO } from './format';

export interface ProjectModel {
  /** Состояние с сервера. */
  base: ProjectState;
  baseAnalysis: Analysis;
  baseForecast: Forecast;
  /** Состояние с учётом черновика (что будет, если применить). */
  state: ProjectState;
  analysis: Analysis;
  forecast: Forecast;
  /** Шторм-тест по состоянию с учётом черновика. */
  threats: Threat[];
  impact: ImpactReport | null;
  ops: ChangeOp[];
  today: string;
}

export function useProjectModel(base: ProjectState | undefined): ProjectModel | null {
  const ops = useDraft((s) => s.ops);
  const today = todayISO();
  // База пересчитывается только при ответе сервера, черновик — при каждой правке.
  const baseModel = useMemo(
    () => (base ? { analysis: analyze(base, today), forecast: forecast(base, today) } : null),
    [base, today],
  );
  const model = useMemo(() => {
    if (!base || !baseModel) return null;
    const common = {
      base,
      baseAnalysis: baseModel.analysis,
      baseForecast: baseModel.forecast,
      today,
    };
    const clean = {
      ...common,
      state: base,
      analysis: baseModel.analysis,
      forecast: baseModel.forecast,
    };
    if (ops.length === 0) return { ...clean, impact: null, ops };
    try {
      const state = applyChangeSet(base, ops);
      const analysis = analyze(state, today);
      const impact = diffAnalyses(base, baseModel.analysis, state, analysis, ops);
      return { ...common, state, analysis, forecast: forecast(state, today), impact, ops };
    } catch {
      // Черновик устарел относительно сервера (например, после отката) — показываем базу.
      return { ...clean, impact: null, ops: [] };
    }
  }, [base, baseModel, ops, today]);
  const threats = useMemo(
    () => (model ? stressTest(model.state, model.analysis, today) : []),
    [model, today],
  );
  return model ? { ...model, threats } : null;
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

/**
 * Как `usePropose`, но запоминает, что это было за действие (имя варианта по умолчанию),
 * и подставляет причину для журнала, если руководитель не ввёл свою.
 */
export function useProposeAction() {
  const propose = usePropose();
  return useCallback(
    (ops: ChangeOp[], { action, reason }: { action: string; reason?: string }) => {
      if (!propose(...ops)) return false;
      const draft = useDraft.getState();
      useDraft.setState({ lastAction: action, reason: draft.reason || reason || '' });
      return true;
    },
    [propose],
  );
}
