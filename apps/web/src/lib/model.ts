import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { newId, todayISO } from './format';

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

// Задача, которую только что создали: редактор откроется с выделенным названием, чтобы сразу его ввести.
let focusNameOf: string | null = null;
export function takeNameFocus(taskId: string): boolean {
  if (focusNameOf !== taskId) return false;
  focusNameOf = null;
  return true;
}

/** Новая задача на 3 дня в конце плана: попадает в черновик и сразу открывается в редакторе. */
export function useAddTask() {
  const { state } = useModel();
  const propose = usePropose();
  const select = useDraft((s) => s.select);
  return useCallback(() => {
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
    if (ok) {
      focusNameOf = id;
      select(id);
    }
  }, [propose, select, state.project.id, state.tasks]);
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

export interface RecalcFlash {
  /** Задачи, у которых после последнего пересчёта сменились даты (или которые только что появились). */
  ids: ReadonlySet<string>;
  /** Меняется при каждой вспышке — ключ, чтобы анимация проигрывалась заново. */
  stamp: number;
}

const NO_FLASH: RecalcFlash = { ids: new Set(), stamp: 0 };

/**
 * Какие задачи коротко подсветить после пересчёта: сравнивает даты с прошлым анализом.
 * При первом показе вида ничего не подсвечивает — вспышка только в ответ на изменение.
 */
export function useRecalcFlash(analysis: Analysis): RecalcFlash {
  const prev = useRef<Map<string, string> | null>(null);
  const [flash, setFlash] = useState<RecalcFlash>(NO_FLASH);
  useEffect(() => {
    const next = new Map(
      Object.entries(analysis.tasks).map(([id, t]) => [id, `${t.startDate}|${t.endDate}`]),
    );
    const before = prev.current;
    prev.current = next;
    if (!before) return;
    const ids = new Set<string>();
    for (const [id, dates] of next) if (before.get(id) !== dates) ids.add(id);
    if (ids.size > 0) setFlash((f) => ({ ids, stamp: f.stamp + 1 }));
  }, [analysis]);
  return flash;
}
