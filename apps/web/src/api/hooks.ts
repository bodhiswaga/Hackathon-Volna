import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChangeOp, ProjectState } from '@volna/engine';
import { toast, useDraft } from '../store/draft';
import { api, type CreateProjectInput } from './client';

export const keys = {
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  changes: (id: string) => ['changes', id] as const,
};

const onError = (e: Error) => toast(e.message, 'error');

export function useProjects() {
  return useQuery({ queryKey: keys.projects, queryFn: api.listProjects });
}

export function useProject(id: string) {
  return useQuery({ queryKey: keys.project(id), queryFn: () => api.getProject(id) });
}

export function useChanges(id: string) {
  return useQuery({ queryKey: keys.changes(id), queryFn: () => api.listChanges(id) });
}

function useStateUpdater(id: string) {
  const qc = useQueryClient();
  return (state: ProjectState) => {
    qc.setQueryData(keys.project(id), state);
    qc.invalidateQueries({ queryKey: keys.changes(id) });
    qc.invalidateQueries({ queryKey: keys.projects });
  };
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => api.createProject(input),
    onSuccess: (state) => {
      qc.setQueryData(keys.project(state.project.id), state);
      qc.invalidateQueries({ queryKey: keys.projects });
    },
    onError,
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.projects }),
    onError,
  });
}

export function useApplyChanges(id: string) {
  const update = useStateUpdater(id);
  const clearDraft = useDraft((s) => s.clearDraft);
  return useMutation({
    mutationFn: (body: { ops: ChangeOp[]; reason?: string }) => api.applyChanges(id, body),
    onSuccess: ({ state }) => {
      update(state);
      clearDraft();
      toast('Изменения применены и записаны в журнал', 'success');
    },
    onError,
  });
}

export function useRevert(id: string) {
  const update = useStateUpdater(id);
  const clearDraft = useDraft((s) => s.clearDraft);
  return useMutation({
    mutationFn: (eventId: string) => api.revert(id, eventId),
    onSuccess: ({ state }) => {
      update(state);
      clearDraft();
      toast('План возвращён к прежнему состоянию', 'success');
    },
    onError,
  });
}

export function usePeopleMutations(id: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: keys.project(id) });
  return {
    add: useMutation({
      mutationFn: (input: { name: string; role: string }) => api.addPerson(id, input),
      onSuccess: refresh,
      onError,
    }),
    update: useMutation({
      mutationFn: (v: { personId: string; name?: string; role?: string }) =>
        api.updatePerson(id, v.personId, { name: v.name, role: v.role }),
      onSuccess: refresh,
      onError,
    }),
    remove: useMutation({
      mutationFn: (personId: string) => api.deletePerson(id, personId),
      onSuccess: refresh,
      onError,
    }),
  };
}

export function useResetDemo() {
  const qc = useQueryClient();
  const clearDraft = useDraft((s) => s.clearDraft);
  return useMutation({
    mutationFn: api.resetDemo,
    onSuccess: (state) => {
      qc.setQueryData(keys.project(state.project.id), state);
      qc.invalidateQueries({ queryKey: keys.changes(state.project.id) });
      qc.invalidateQueries({ queryKey: keys.projects });
      clearDraft();
      toast('Демо-проект пересоздан', 'success');
    },
    onError,
  });
}
