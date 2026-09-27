import type { LiveEvent } from '@todoodle/shared/events';
import type { SocketLike } from '@/features/live/LiveConnection';
import { WS_ID, workspace } from './fixtures';

/** Realistic ids: UUID client ids, 16-byte hex entity ids. */
export const SELF_CLIENT = '0b7c2f1e-9a4d-4c3b-8e2f-5a6b7c8d9e0f';
export const OTHER_CLIENT = '6c1f7a52-3d4e-4f8a-9b0c-1d2e3f4a5b6c';
export const TASK_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

export function renameEvent(name: string, version: number, originClientId: string | null = OTHER_CLIENT): LiveEvent {
  return { type: 'workspace.updated', entity: workspace({ name, version }), version, originClientId };
}

export function taskUpserted(fields: Record<string, string | null>, version: number, originClientId: string | null = OTHER_CLIENT): LiveEvent {
  return { type: 'task.upserted', entity: { id: TASK_ID, version, ...fields }, version, originClientId };
}

export function taskDeleted(version: number, originClientId: string | null = OTHER_CLIENT): LiveEvent {
  return { type: 'task.deleted', entity: { id: TASK_ID }, version, originClientId };
}

export { WS_ID };

/** A socket the test drives by hand (server side: open, message, close). */
export class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  sent: string[] = [];
  closedWith: number | undefined;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  static get last(): FakeSocket {
    return FakeSocket.all[FakeSocket.all.length - 1]!;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith = code ?? 1000;
  }
  serverOpen() {
    this.onopen?.(new Event('open'));
  }
  serverSend(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent);
  }
  serverClose(code = 1006) {
    this.onclose?.({ code } as CloseEvent);
  }
}
