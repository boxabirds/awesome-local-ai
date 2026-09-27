import { RememberedListResponse, type RememberedPublic, type Workspace } from '@todoodle/shared/schemas';
import { http, HttpResponse } from 'msw';

/** Shapes follow packages/shared schemas; values look like real ones (32-hex ids, 43-char secrets). */
export const SECRET = 'XndWJwDqchaBV0DPQNeYWVlBHgWT2qCwxEKIdI-7ZoQ';
export const OTHER_SECRET = 'itKKlctGr1Pc2mTB8LWIXOvJOr8DrCDnOc0XzBmj5EQ';
export const WS_ID = '0123456789abcdef0123456789abcdef';

export function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return { id: WS_ID, name: 'My Todoodle', version: 1, createdAt: '2026-09-27 10:00:00', ...overrides };
}

export const NOT_FOUND_BODY = { error: 'not_found', message: 'Workspace not found' };

export const handlers = {
  create: (ws = workspace(), secret = SECRET) =>
    http.post('/api/workspaces', () => HttpResponse.json({ workspace: ws, secret, dropped: 0 }, { status: 201 })),
  open: (ws = workspace()) => http.post('/api/workspaces/open', () => HttpResponse.json({ workspace: ws, dropped: 0 })),
  openNotFound: () => http.post('/api/workspaces/open', () => HttpResponse.json(NOT_FOUND_BODY, { status: 404 })),
  get: (ws = workspace()) => http.get('/api/w/:id', () => HttpResponse.json({ workspace: ws })),
  link: (link: string) => http.get('/api/w/:id/link', () => HttpResponse.json({ link })),
};

/* Story 3: this browser's remembered workspaces. Bodies are parsed through the shared schema. */

export const A_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01';
export const B_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb02';
export const C_ID = 'cccccccccccccccccccccccccccccc03';
export const X_ID = 'dddddddddddddddddddddddddddddd04';
export const Y_ID = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeee05';

export const linkFor = (secret: string) => `${window.location.origin}/w#${secret}`;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export function rememberedEntry(id: string, name: string | null, minutes = 5): RememberedPublic {
  return { id, name, lastOpenedAt: minutesAgo(minutes), available: name !== null };
}

export function rememberedBody(list: RememberedPublic[]): RememberedListResponse {
  return RememberedListResponse.parse({ workspaces: list });
}

export const rememberedHandlers = {
  list: (list: RememberedPublic[]) => http.get('/api/remembered', () => HttpResponse.json(rememberedBody(list))),
  /** GET /api/w/:id answering with the name from `names` (by id). */
  workspaces: (names: Record<string, string>) =>
    http.get('/api/w/:id', ({ params }) => {
      const id = String(params.id);
      const name = names[id];
      return name === undefined
        ? HttpResponse.json(NOT_FOUND_BODY, { status: 404 })
        : HttpResponse.json({ workspace: workspace({ id, name }) });
    }),
};
