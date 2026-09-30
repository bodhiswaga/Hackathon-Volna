import { create } from 'zustand';
import type { ChangeOp, ProjectEventKind } from '@volna/engine';

export type ViewTab = 'timeline' | 'risks' | 'graph' | 'table' | 'journal' | 'team';
export type SidePanel = 'auto' | 'advisor' | 'project';

/** Сохранённый черновик для сравнения «Вариантов». */
export interface Scenario {
  id: string;
  /** Буква закрепляется при сохранении: удаление одного варианта не переименовывает другие. */
  letter: string;
  name: string;
  ops: ChangeOp[];
}

/** Открытое окно «Что случилось?» с предзаполнением. */
export interface EventRequest {
  kind: ProjectEventKind;
  personId?: string;
  taskId?: string;
}

export const SCENARIO_LETTERS = ['А', 'Б', 'В', 'Г'];
const MAX_SCENARIOS = SCENARIO_LETTERS.length;

export const sameOps = (a: ChangeOp[], b: ChangeOp[]) => JSON.stringify(a) === JSON.stringify(b);

// Варианты живут в браузере: это заготовки решений, а не данные проекта.
const scenariosKey = (projectId: string) => `volna:scenarios:v1:${projectId}`;

function loadScenarios(projectId: string): Scenario[] {
  try {
    const raw = localStorage.getItem(scenariosKey(projectId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is Scenario =>
        typeof x === 'object' &&
        x !== null &&
        typeof x.id === 'string' &&
        typeof x.letter === 'string' &&
        typeof x.name === 'string' &&
        Array.isArray(x.ops),
    );
  } catch {
    return [];
  }
}

function storeScenarios(projectId: string | null, scenarios: Scenario[]) {
  if (!projectId) return;
  try {
    localStorage.setItem(scenariosKey(projectId), JSON.stringify(scenarios));
  } catch {
    // Хранилище недоступно (приватный режим) — варианты живут до перезагрузки.
  }
}

interface DraftStore {
  projectId: string | null;
  /** Черновик изменений: применяется локально для what-if, на сервер уходит по «Применить». */
  ops: ChangeOp[];
  /** Прежние состояния черновика — для Ctrl+Z (последнее — сверху). */
  history: ChangeOp[][];
  /** Причина изменения для журнала; события «Что случилось?» подставляют её сами. */
  reason: string;
  /** Последнее действие, добавленное в черновик, — имя варианта по умолчанию. */
  lastAction: string;
  /** Решение из советника, если черновик собран им: попадает в письмо заказчику. */
  solution: string;
  selectedTaskId: string | null;
  tab: ViewTab;
  side: SidePanel;
  scenarios: Scenario[];
  event: EventRequest | null;
  compareOpen: boolean;
  openProject: (id: string) => void;
  setOps: (ops: ChangeOp[]) => void;
  /** Вернуть черновик на шаг назад; false — отменять нечего. */
  undo: () => boolean;
  setReason: (reason: string) => void;
  clearDraft: () => void;
  select: (taskId: string | null) => void;
  setTab: (tab: ViewTab) => void;
  setSide: (side: SidePanel) => void;
  /** Сохраняет вариант и возвращает его букву; при переполнении вытесняет самый старый. */
  saveScenario: (scenario: Omit<Scenario, 'letter'>) => string;
  removeScenario: (id: string) => void;
  renameScenario: (id: string, name: string) => void;
  clearScenarios: () => void;
  openEvent: (event: EventRequest | null) => void;
  setCompareOpen: (open: boolean) => void;
}

const HISTORY_LIMIT = 50;

export const useDraft = create<DraftStore>((set, get) => ({
  projectId: null,
  ops: [],
  history: [],
  reason: '',
  lastAction: '',
  solution: '',
  selectedTaskId: null,
  tab: 'timeline',
  side: 'auto',
  scenarios: [],
  event: null,
  compareOpen: false,
  openProject: (id) => {
    if (get().projectId !== id) {
      set({
        projectId: id,
        ops: [],
        history: [],
        reason: '',
        lastAction: '',
        solution: '',
        selectedTaskId: null,
        side: 'auto',
        scenarios: loadScenarios(id),
        event: null,
        compareOpen: false,
      });
    }
  },
  setOps: (ops) =>
    set((s) =>
      s.ops === ops
        ? s
        : {
            ops,
            history: [...s.history, s.ops].slice(-HISTORY_LIMIT),
            // Черновик опустел — выбранного решения больше нет.
            ...(ops.length === 0 ? { solution: '' } : {}),
          },
    ),
  undo: () => {
    const { history } = get();
    if (history.length === 0) return false;
    const ops = history[history.length - 1]!;
    set({ ops, history: history.slice(0, -1), ...(ops.length === 0 ? { solution: '' } : {}) });
    return true;
  },
  setReason: (reason) => set({ reason }),
  clearDraft: () => set({ ops: [], history: [], reason: '', lastAction: '', solution: '' }),
  select: (selectedTaskId) => set({ selectedTaskId, side: 'auto' }),
  setTab: (tab) => set({ tab }),
  setSide: (side) => set({ side }),
  saveScenario: (scenario) => {
    const kept = get().scenarios.slice(-(MAX_SCENARIOS - 1));
    const letter = SCENARIO_LETTERS.find((l) => !kept.some((x) => x.letter === l))!;
    const scenarios = [...kept, { ...scenario, letter }];
    storeScenarios(get().projectId, scenarios);
    set({ scenarios });
    return letter;
  },
  removeScenario: (id) => {
    const scenarios = get().scenarios.filter((x) => x.id !== id);
    storeScenarios(get().projectId, scenarios);
    set({ scenarios });
  },
  renameScenario: (id, name) => {
    const scenarios = get().scenarios.map((x) => (x.id === id ? { ...x, name } : x));
    storeScenarios(get().projectId, scenarios);
    set({ scenarios });
  },
  clearScenarios: () => {
    storeScenarios(get().projectId, []);
    set({ scenarios: [] });
  },
  openEvent: (event) => set({ event }),
  setCompareOpen: (compareOpen) => set({ compareOpen }),
}));

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
  action?: ToastAction;
}

interface ToastStore {
  toasts: Toast[];
  push: (text: string, tone?: Toast['tone'], options?: { action?: ToastAction }) => void;
  dismiss: (id: number) => void;
}

let toastSeq = 0;
/** Больше трёх уведомлений разом не читаются — старые уступают место. */
const MAX_TOASTS = 3;

// Таймер скрытия живёт в самом тосте (пауза при наведении), здесь только список.
export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push: (text, tone = 'info', options) => {
    const id = ++toastSeq;
    set((s) => ({
      toasts: [...s.toasts, { id, text, tone, action: options?.action }].slice(-MAX_TOASTS),
    }));
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (text: string, tone?: Toast['tone'], options?: { action?: ToastAction }) =>
  useToasts.getState().push(text, tone, options);

export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmLabel: string;
  danger?: boolean;
}

interface ConfirmStore {
  request: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null;
}

export const useConfirmStore = create<ConfirmStore>(() => ({ request: null }));

/** Подтверждение необратимого действия в собственном диалоге вместо системного confirm(). */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.setState({
      request: {
        ...options,
        resolve: (ok) => {
          useConfirmStore.setState({ request: null });
          resolve(ok);
        },
      },
    });
  });
}
