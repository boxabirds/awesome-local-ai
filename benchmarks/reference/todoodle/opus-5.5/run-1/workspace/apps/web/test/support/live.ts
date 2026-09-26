import { LiveEvent } from '@todoodle/shared/events';
import { type Workspace, WorkspaceResponse } from '@todoodle/shared/schemas';
import { http, HttpResponse } from 'msw';
import { type Client, Server, WebSocket as MockWebSocket } from 'mock-socket';
import { setDefaultSocketFactory } from '@/features/live/LiveConnection';
import { server as msw } from '../msw.ts';
import { WORKSPACE } from './fixtures.ts';

/** The URL LiveConnection opens for a workspace in this test document. */
export function liveUrl(id = WORKSPACE.id): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/w/${encodeURIComponent(id)}/live`;
}

export type LiveServer = {
  /** Every socket LiveConnection has constructed (connected or not). */
  constructed: string[];
  clients(): Client[];
  /** Sends a live event to every connected client, as the WorkspaceRoom would. */
  emit(event: LiveEvent | string): void;
  /** Closes every client's socket from the server side. */
  drop(code?: number): void;
  stop(): void;
};

/**
 * A mock-socket server for the workspace's live endpoint. Answers ping with pong like the Durable
 * Object's auto-response. Stopped after each test by stopLiveServers() (test/setup.ts).
 */
export function startLiveServer(id = WORKSPACE.id): LiveServer {
  const url = liveUrl(id);
  // mock: false leaves the global WebSocket alone; LiveConnection gets mock sockets through its factory.
  const server = new Server(url, { mock: false });
  const constructed: string[] = [];
  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      if (data === 'ping') socket.send('pong');
    });
  });
  setDefaultSocketFactory((target) => {
    constructed.push(target);
    return new MockWebSocket(target) as unknown as WebSocket;
  });
  const live: LiveServer = {
    constructed,
    clients: () => server.clients(),
    emit(event) {
      const frame = typeof event === 'string' ? event : JSON.stringify(event);
      for (const client of server.clients()) client.send(frame);
    },
    drop(code = 1006) {
      for (const client of server.clients()) client.close({ code, reason: 'dropped', wasClean: false });
    },
    stop() {
      server.stop();
      const index = servers.indexOf(live);
      if (index >= 0) servers.splice(index, 1);
    },
  };
  servers.push(live);
  return live;
}

const servers: LiveServer[] = [];

export function stopLiveServers(): void {
  for (const live of [...servers]) live.stop();
}

/** MSW: GET /api/health answers 200 (online) or fails at network level (offline). */
export function healthHandler(ok: boolean) {
  return http.get('/api/health', () => (ok ? HttpResponse.json({ ok: true }) : HttpResponse.error()));
}

export function useHealth(ok: boolean): void {
  msw.use(healthHandler(ok));
}

/**
 * A stateful stand-in for the workspace API (GET and PATCH /api/w/:id), so refetches after a rename
 * or a recovery see the latest saved state, like the real server. `remoteRename` is another person's
 * save: it updates the state and returns the live event the server would broadcast.
 */
export function workspaceBackend(initial: Workspace = WORKSPACE) {
  let current = { ...initial };
  const patches: Array<{ name: string }> = [];
  msw.use(
    http.get('/api/w/:id', () => HttpResponse.json(WorkspaceResponse.parse({ workspace: current }))),
    http.patch('/api/w/:id', async ({ request }) => {
      const body = (await request.json()) as { name: string };
      patches.push(body);
      current = { ...current, name: body.name, version: current.version + 1 };
      return HttpResponse.json(WorkspaceResponse.parse({ workspace: current }));
    }),
  );
  return {
    patches,
    current: () => current,
    remoteRename(name: string, originClientId: string | null = REMOTE_CLIENT): LiveEvent {
      current = { ...current, name, version: current.version + 1 };
      return LiveEvent.parse({ type: 'workspace.updated', entity: current, version: current.version, originClientId });
    },
  };
}

export const REMOTE_CLIENT = '0b9f7c53-3e1a-4d2b-9c8e-7a6f5e4d3c2b';
