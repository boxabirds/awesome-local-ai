import { z } from 'zod';
import { Workspace } from './schemas';

/** The workspace as carried by live events (the public shape, never the secret). */
export const WorkspaceDTO = Workspace;
export type WorkspaceDTO = z.infer<typeof WorkspaceDTO>;

/** Placeholder: story 5 (tasks) extends this schema. The union shape below is frozen. */
export const TaskDTO = z.looseObject({ id: z.string(), version: z.number().int() });
export type TaskDTO = z.infer<typeof TaskDTO>;

/** Placeholder: story 7 (projects) extends this schema. */
export const ProjectDTO = z.looseObject({ id: z.string(), version: z.number().int() });
export type ProjectDTO = z.infer<typeof ProjectDTO>;

const base = {
  version: z.number().int(),
  originClientId: z.string().nullable(),
};
const Deleted = z.object({ id: z.string() });

/**
 * Every change the server fans out to a workspace's live sockets. `version` is the entity's
 * post-write version; `originClientId` is the X-Todoodle-Client-Id of the tab that made the write.
 */
export const LiveEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace.updated'), entity: WorkspaceDTO, ...base }),
  z.object({ type: z.literal('project.upserted'), entity: ProjectDTO, ...base }),
  z.object({ type: z.literal('project.restored'), entity: ProjectDTO, ...base }),
  z.object({ type: z.literal('project.deleted'), entity: Deleted, ...base }),
  z.object({ type: z.literal('task.upserted'), entity: TaskDTO, ...base }),
  z.object({ type: z.literal('task.restored'), entity: TaskDTO, ...base }),
  z.object({ type: z.literal('task.deleted'), entity: Deleted, ...base }),
  z.object({ type: z.literal('tasks.bulk'), entity: z.object({ ids: z.array(z.string()) }), ...base }),
]);
export type LiveEvent = z.infer<typeof LiveEvent>;
export type LiveEventType = LiveEvent['type'];

/** Every event type literal (the design says 9; its union lists these 8). */
export const LIVE_EVENT_TYPES = [
  'workspace.updated',
  'project.upserted',
  'project.restored',
  'project.deleted',
  'task.upserted',
  'task.restored',
  'task.deleted',
  'tasks.bulk',
] as const satisfies readonly LiveEventType[];

/** An event before the broadcast helper stamps the origin. */
export type LiveEventInput = LiveEvent extends infer E ? (E extends LiveEvent ? Omit<E, 'originClientId'> : never) : never;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** UTF-8 size of the event as sent on the wire. */
export function eventByteSize(event: LiveEvent): number {
  return new TextEncoder().encode(JSON.stringify(event)).byteLength;
}
