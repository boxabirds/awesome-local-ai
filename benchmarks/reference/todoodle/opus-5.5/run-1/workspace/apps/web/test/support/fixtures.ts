import { http, HttpResponse } from 'msw';
import { server } from '../msw.ts';
import {
  CreateWorkspaceResponse,
  OpenWorkspaceResponse,
  type Workspace,
  WorkspaceLinkResponse,
  WorkspaceResponse,
  Workspace as WorkspaceSchema,
} from '@todoodle/shared/schemas';

/** Real shapes: a 43-char base64url secret and a 32-hex id, as the API produces them. */
export const SECRET = 'q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c';
export const WORKSPACE: Workspace = WorkspaceSchema.parse({
  id: '0123456789ABCDEF0123456789ABCDEF',
  name: 'My Todoodle',
  version: 1,
  createdAt: '2026-09-26 10:00:00',
});

export function linkFor(secret = SECRET): string {
  return `${window.location.origin}/w#${secret}`;
}

type Hooks = {
  onRequest?: (body: unknown) => void;
  workspace?: Workspace;
  status?: number;
  /** The response waits for this promise (to observe pending states). */
  until?: Promise<unknown>;
};

export function createHandler({ onRequest, workspace = WORKSPACE, status = 201, until }: Hooks = {}) {
  return http.post('/api/workspaces', async ({ request }) => {
    onRequest?.(await request.text());
    await until;
    if (status !== 201) return HttpResponse.json({ error: 'internal', message: 'x' }, { status });
    return HttpResponse.json(CreateWorkspaceResponse.parse({ workspace, secret: SECRET, dropped: 0 }), { status });
  });
}

export function openHandler({ onRequest, workspace = WORKSPACE, until }: Hooks = {}) {
  return http.post('/api/workspaces/open', async ({ request }) => {
    onRequest?.(await request.json());
    await until;
    return HttpResponse.json(OpenWorkspaceResponse.parse({ workspace, dropped: 0 }));
  });
}

export function getHandler({ onRequest, workspace = WORKSPACE, until }: Hooks = {}) {
  return http.get('/api/w/:id', async ({ request }) => {
    onRequest?.(request.url);
    await until;
    return HttpResponse.json(WorkspaceResponse.parse({ workspace }));
  });
}

export function linkHandler({ onRequest, until }: Hooks = {}) {
  return http.get('/api/w/:id/link', async ({ request }) => {
    onRequest?.(request.url);
    await until;
    return HttpResponse.json(WorkspaceLinkResponse.parse({ link: linkFor() }));
  });
}

/** A promise and its resolver, to hold a mocked response until the test releases it. */
export function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

type RequestListener = (event: { request: Request }) => void;
const recorders: RequestListener[] = [];

/** Records every request MSW sees as 'METHOD /path'. Stopped after each test (test/setup.ts). */
export function recordRequests(): string[] {
  const seen: string[] = [];
  const listener: RequestListener = ({ request }) => {
    seen.push(`${request.method} ${new URL(request.url).pathname}`);
  };
  server.events.on('request:start', listener);
  recorders.push(listener);
  return seen;
}

export function stopRecordingRequests(): void {
  for (const listener of recorders.splice(0)) server.events.removeListener('request:start', listener);
}
