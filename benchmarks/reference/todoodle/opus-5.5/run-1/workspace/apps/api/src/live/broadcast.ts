import { CLIENT_ID_HEADER_NAME, LIVE_MAX_EVENT_BYTES } from '@todoodle/shared/limits';
import { LiveEvent, type LiveEventInput, eventByteSize, isUuid } from '@todoodle/shared/events';
import type { Context } from 'hono';
import type { AppEnv } from '../app.ts';

export type AppContext = Context<AppEnv>;

/** Header the web client sends on every request: its per-tab id, so it can ignore its own echoes. */
export const CLIENT_ID_HEADER = CLIENT_ID_HEADER_NAME;

/** The request's client id when it is a UUID, otherwise null (never trusted as anything but an echo tag). */
export function originClientIdFrom(headerValue: string | null | undefined): string | null {
  return isUuid(headerValue) ? headerValue : null;
}

function logBroadcastFailure(requestId: string, reason: string, error?: unknown): void {
  // Sanitised: only the request id, a reason and the error's own name/message. Never the event payload.
  const errorName = error instanceof Error ? error.name : undefined;
  const errorMessage = error instanceof Error ? error.message : undefined;
  console.error('live broadcast failed', { requestId, reason, errorName, errorMessage });
}

/**
 * Validates the event and returns it stamped with its origin, or null (and logs) when it is invalid
 * or larger than LIVE_MAX_EVENT_BYTES. Exported for unit tests.
 */
export function prepareEvent(event: LiveEventInput, originClientId: string | null, requestId: string): LiveEvent | null {
  const parsed = LiveEvent.safeParse({ ...event, originClientId });
  if (!parsed.success) {
    logBroadcastFailure(requestId, 'invalid_event');
    return null;
  }
  if (eventByteSize(parsed.data) > LIVE_MAX_EVENT_BYTES) {
    logBroadcastFailure(requestId, 'event_too_large');
    return null;
  }
  return parsed.data;
}

/**
 * Fans a change out to everyone with this workspace open, via its WorkspaceRoom Durable Object.
 *
 * Rule for stories 5 to 8: every successful D1 write calls broadcast exactly once, AFTER the write
 * commits, with the post-write entity and version. Validation failures and no-op writes never broadcast.
 *
 * Fire and forget: the RPC runs in waitUntil, so the caller never awaits it. It never throws into the
 * caller; a failure is logged with the request id and the mutation response is unaffected.
 *
 * @example
 *   const row = await updateTask(c.env.DB, ...);            // committed
 *   broadcast(c, workspaceId, { type: 'task.upserted', entity: toTaskDTO(row), version: row.version });
 *   return c.json({ task: toTaskDTO(row) });
 */
export function broadcast(c: AppContext, workspaceId: string, event: LiveEventInput): void {
  const requestId = c.get('requestId');
  try {
    const prepared = prepareEvent(event, originClientIdFrom(c.req.header(CLIENT_ID_HEADER)), requestId);
    if (!prepared) return;
    const room = c.env.WORKSPACE_ROOM.get(c.env.WORKSPACE_ROOM.idFromName(workspaceId));
    const delivery = Promise.resolve()
      .then(() => room.broadcast(prepared))
      .catch((error: unknown) => logBroadcastFailure(requestId, 'rpc_failed', error));
    c.executionCtx.waitUntil(delivery);
  } catch (error) {
    logBroadcastFailure(requestId, 'rpc_failed', error);
  }
}
