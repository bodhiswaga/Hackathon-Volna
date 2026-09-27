import type { Analysis, ChangeOp, Health, Person, Project, ProjectState } from '@volna/engine';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'unknown',
      data?.error?.message ?? 'Сервер не ответил. Проверьте, что backend запущен.',
    );
  }
  return data as T;
}

export interface ProjectListItem {
  project: Project;
  health: Health;
  finishDate: string;
  bufferDays: number;
  stats: Analysis['stats'];
  peopleCount: number;
}

export interface ChangeEvent {
  id: string;
  projectId: string;
  createdAt: string;
  title: string;
  reason: string | null;
  ops: ChangeOp[];
  finishBefore: string;
  finishAfter: string;
  bufferBefore: number;
  bufferAfter: number;
}

export interface CreateProjectInput {
  name: string;
  description: string;
  startDate: string;
  deadline: string;
}

export const api = {
  listProjects: () => request<ProjectListItem[]>('GET', '/projects'),
  getProject: (id: string) => request<ProjectState>('GET', `/projects/${id}`),
  createProject: (input: CreateProjectInput) => request<ProjectState>('POST', '/projects', input),
  deleteProject: (id: string) => request<void>('DELETE', `/projects/${id}`),
  applyChanges: (id: string, body: { ops: ChangeOp[]; reason?: string; title?: string }) =>
    request<{ state: ProjectState; event: ChangeEvent }>('POST', `/projects/${id}/changes`, body),
  listChanges: (id: string) => request<ChangeEvent[]>('GET', `/projects/${id}/changes`),
  revert: (id: string, eventId: string) =>
    request<{ state: ProjectState; event: ChangeEvent }>(
      'POST',
      `/projects/${id}/changes/${eventId}/revert`,
    ),
  addPerson: (id: string, input: { name: string; role: string }) =>
    request<Person>('POST', `/projects/${id}/people`, input),
  updatePerson: (id: string, personId: string, patch: Partial<Pick<Person, 'name' | 'role' | 'color'>>) =>
    request<Person>('PATCH', `/projects/${id}/people/${personId}`, patch),
  deletePerson: (id: string, personId: string) =>
    request<void>('DELETE', `/projects/${id}/people/${personId}`),
  resetDemo: () => request<ProjectState>('POST', '/demo/reset'),
};
