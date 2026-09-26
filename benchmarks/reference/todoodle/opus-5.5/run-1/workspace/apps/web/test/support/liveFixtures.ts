import { LiveEvent } from '@todoodle/shared/events';
import type { Workspace } from '@todoodle/shared/schemas';

/** Realistic fixtures from the zod types: 16-byte hex ids, UUID client ids. */
export const WS_ID = '0123456789ABCDEF0123456789ABCDEF';
export const TASK_ID = 'A1B2C3D4E5F60718293A4B5C6D7E8F90';
export const OTHER_CLIENT = '0b9f7c53-3e1a-4d2b-9c8e-7a6f5e4d3c2b';

export function workspaceAt(version: number, name = 'Groceries'): Workspace {
  return { id: WS_ID, name, version, createdAt: '2026-09-26 10:00:00' };
}

export function workspaceUpdated(version: number, originClientId: string | null, name = `Name v${version}`): LiveEvent {
  return LiveEvent.parse({ type: 'workspace.updated', entity: workspaceAt(version, name), version, originClientId });
}

export function taskUpserted(fields: Record<string, string | null>, originClientId: string | null = OTHER_CLIENT, version = 2): LiveEvent {
  return LiveEvent.parse({ type: 'task.upserted', entity: { id: TASK_ID, version, ...fields }, version, originClientId });
}

export function taskDeleted(originClientId: string | null = OTHER_CLIENT, version = 3): LiveEvent {
  return LiveEvent.parse({ type: 'task.deleted', entity: { id: TASK_ID }, version, originClientId });
}

/**
 * A scriptable stand-in for the browser WebSocket (unit tests: logic, not transport).
 * The test drives it: open(), receive(), serverClose().
 */
export class FakeSocket extends EventTarget {
  static instances: FakeSocket[] = [];
  readonly url: string;
  readonly sent: string[] = [];
  closedWith: number | null = null;
  readyState = 0;

  constructor(url: string) {
    super();
    this.url = url;
    FakeSocket.instances.push(this);
  }

  static factory = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket;

  static latest(): FakeSocket {
    const socket = FakeSocket.instances.at(-1);
    if (!socket) throw new Error('no socket created');
    return socket;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    this.closedWith = code;
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }

  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: typeof data === 'string' ? data : JSON.stringify(data) }));
  }

  serverClose(code = 1006): void {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event('close'), { code }));
  }
}
