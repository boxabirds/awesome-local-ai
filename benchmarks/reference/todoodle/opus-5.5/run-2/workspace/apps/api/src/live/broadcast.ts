import { eventByteSize, isUuid, LiveEvent, type LiveEventInput } from '@todoodle/shared/events';
import { LIVE_MAX_EVENT_BYTES } from '@todoodle/shared/limits';
import type { Context } from 'hono';
import type { AppEnv } from '../app';
import { logRequestError } from '../lib/errors';

export const CLIENT_ID_HEADER = 'X-Todoodle-Client-Id';

/** The parts of a request context broadcast() uses (a Hono Context satisfies it). */
export type BroadcastContext = Pick<Context<AppEnv>, 'env' | 'executionCtx' | 'get' | 'req'>;

/** The tab that made the write, from X-Todoodle-Client-Id; anything that isn't a UUID is null. */
export function originClientIdFrom(header: string | undefined | null): string | null {
  return isUuid(header) ? header.toLowerCase() : null;
}

function logBroadcastFailure(c: BroadcastContext, err: unknown): void {
  logRequestError({
    requestId: c.get('requestId'),
    method: c.req.method,
    pathname: c.req.path,
    status: 200,
    errorName: err instanceof Error ? err.name : 'BroadcastError',
    errorMessage: err instanceof Error ? err.message : String(err),
  });
}

/**
 * Fans a committed change out to everyone with the workspace open. Fire and forget: the RPC runs
 * in waitUntil, and a failure is only logged (with the request id), so it never affects the
 * mutation's response. Never throws and is never awaited.
 *
 * Rule for stories 5 to 8: every successful D1 write calls broadcast exactly once, after the
 * write commits, with the post-write entity and version. Validation failures, failed writes and
 * no-op writes never broadcast.
 *
 * @example
 * const row = await updateTask(c.env.DB, id, patch);
 * broadcast(c, workspaceId, { type: 'task.upserted', entity: toTaskDTO(row), version: row.version });
 * return c.json({ task: toTaskDTO(row) });
 */
export function broadcast(c: BroadcastContext, workspaceId: string, event: LiveEventInput): void {
  try {
    const full = LiveEvent.parse({ ...event, originClientId: originClientIdFrom(c.req.header(CLIENT_ID_HEADER)) });
    const size = eventByteSize(full);
    if (size > LIVE_MAX_EVENT_BYTES) {
      logBroadcastFailure(c, new Error(`live event too large: ${size} bytes (${full.type})`));
      return;
    }
    const room = c.env.WORKSPACE_ROOM;
    const delivery = Promise.resolve()
      .then(() => room.get(room.idFromName(workspaceId)).broadcast(full))
      .catch((err: unknown) => logBroadcastFailure(c, err));
    c.executionCtx.waitUntil(delivery);
  } catch (err) {
    logBroadcastFailure(c, err);
  }
}
