import { z } from 'zod';
import { TASK_STATUSES } from '@volna/engine';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ожидается дата YYYY-MM-DD');

const taskSchema = z.object({
  id: z.string().min(1).max(100),
  projectId: z.string(),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000),
  durationDays: z.number().int().min(0).max(1000),
  status: z.enum(TASK_STATUSES),
  assigneeId: z.string().nullable(),
  dueDate: isoDate.nullable(),
  startNotEarlier: isoDate.nullable(),
  actualStart: isoDate.nullable(),
  actualEnd: isoDate.nullable(),
  sortOrder: z.number(),
});

const dependencySchema = z.object({
  id: z.string().min(1).max(100),
  projectId: z.string(),
  predecessorId: z.string(),
  successorId: z.string(),
  lagDays: z.number().int().min(-365).max(365),
});

const projectPatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  startDate: isoDate.optional(),
  deadline: isoDate.optional(),
  statusDate: isoDate.nullable().optional(),
});

export const changeOpSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('updateTask'),
    taskId: z.string(),
    patch: taskSchema.omit({ id: true, projectId: true }).partial(),
  }),
  z.object({ type: z.literal('createTask'), task: taskSchema }),
  z.object({ type: z.literal('deleteTask'), taskId: z.string() }),
  z.object({ type: z.literal('addDependency'), dependency: dependencySchema }),
  z.object({ type: z.literal('removeDependency'), dependencyId: z.string() }),
  z.object({
    type: z.literal('updateDependency'),
    dependencyId: z.string(),
    lagDays: z.number().int().min(-365).max(365),
  }),
  z.object({ type: z.literal('updateProject'), patch: projectPatch }),
]);

export const changeBodySchema = z.object({
  title: z.string().max(300).optional(),
  reason: z.string().max(1000).optional(),
  ops: z.array(changeOpSchema).min(1).max(200),
});

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(5000).default(''),
    startDate: isoDate,
    deadline: isoDate,
  })
  .refine((p) => p.deadline >= p.startDate, {
    message: 'Дедлайн не может быть раньше старта',
    path: ['deadline'],
  });

export const updateProjectSchema = projectPatch;

export const personSchema = z.object({
  name: z.string().trim().min(1).max(100),
  role: z.string().max(100).default(''),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export const personPatchSchema = personSchema.partial();
