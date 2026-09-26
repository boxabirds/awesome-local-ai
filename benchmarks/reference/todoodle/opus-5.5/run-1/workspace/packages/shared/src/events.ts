import { z } from 'zod';
import { Workspace } from './schemas.ts';

// Live events (story 4): what the WorkspaceRoom Durable Object fans out to every open tab of a workspace.
// The union's shape is frozen; stories 5 and 7 fill in ProjectDTO and TaskDTO.

/** Placeholder until story 7: every project carries at least its id and version. Extra fields pass through. */
export const ProjectDTO = z.looseObject({ id: z.string(), version: z.number().int() });
export type ProjectDTO = z.infer<typeof ProjectDTO>;

/** Placeholder until story 5: every task carries at least its id and version. Extra fields pass through. */
export const TaskDTO = z.looseObject({ id: z.string(), version: z.number().int() });
export type TaskDTO = z.infer<typeof TaskDTO>;

const base = { version: z.number().int(), originClientId: z.string().nullable() };
const Deleted = z.object({ id: z.string() });

export const LiveEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace.updated'), entity: Workspace, ...base }),
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

/** An event before the server stamps originClientId on it (the argument of broadcast()). */
export type LiveEventInput = LiveEvent extends infer E ? (E extends LiveEvent ? Omit<E, 'originClientId'> : never) : never;

/** Every event type, in declaration order. */
export const LIVE_EVENT_TYPES = LiveEvent.options.map((option) => option.shape.type.value) as LiveEventType[];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical 8-4-4-4-12 hex UUID (any version). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** UTF-8 byte length of a string (no TextEncoder: this package is built without DOM or worker globals). */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      // A surrogate pair is one 4-byte code point.
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** Size of the event as sent on the wire (UTF-8 bytes of its JSON). */
export function eventByteSize(event: unknown): number {
  return utf8Length(JSON.stringify(event));
}
