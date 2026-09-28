import { create } from 'zustand';
import type { ChangeOp } from '@volna/engine';

export type ViewTab = 'timeline' | 'graph' | 'table' | 'journal' | 'team';
export type SidePanel = 'auto' | 'advisor' | 'project';

interface DraftStore {
  projectId: string | null;
  /** Черновик изменений: применяется локально для what-if, на сервер уходит по «Применить». */
  ops: ChangeOp[];
  selectedTaskId: string | null;
  tab: ViewTab;
  side: SidePanel;
  openProject: (id: string) => void;
  setOps: (ops: ChangeOp[]) => void;
  clearDraft: () => void;
  select: (taskId: string | null) => void;
  setTab: (tab: ViewTab) => void;
  setSide: (side: SidePanel) => void;
}

export const useDraft = create<DraftStore>((set, get) => ({
  projectId: null,
  ops: [],
  selectedTaskId: null,
  tab: 'timeline',
  side: 'auto',
  openProject: (id) => {
    if (get().projectId !== id) {
      set({ projectId: id, ops: [], selectedTaskId: null, side: 'auto' });
    }
  },
  setOps: (ops) => set({ ops }),
  clearDraft: () => set({ ops: [] }),
  select: (selectedTaskId) => set({ selectedTaskId, side: 'auto' }),
  setTab: (tab) => set({ tab }),
  setSide: (side) => set({ side }),
}));

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
}

interface ToastStore {
  toasts: Toast[];
  push: (text: string, tone?: Toast['tone']) => void;
  dismiss: (id: number) => void;
}

let toastSeq = 0;

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push: (text, tone = 'info') => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (text: string, tone?: Toast['tone']) => useToasts.getState().push(text, tone);

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
