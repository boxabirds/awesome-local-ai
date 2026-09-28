/**
 * Test-only storage hooks (story 4 e2e).
 *
 * A local `wrangler dev --var TEST_HOOKS:1` exposes
 * `POST /__test/boards/:boardId/<action>` so a browser test can put a board
 * into a state that no user interaction can produce: a large seeded board, a
 * compacted log, an unreadable snapshot, and the repair of one. `wrangler.jsonc`
 * never sets `TEST_HOOKS`, and both the router and the room check it, so the
 * routes do not exist in production.
 */

export type TestHookAction =
  | 'seed'
  | 'compact'
  | 'corrupt-snapshot'
  | 'repair-snapshot'
  | 'repair'
  | 'stats';

const ACTIONS: readonly TestHookAction[] = [
  'seed',
  'compact',
  'corrupt-snapshot',
  'repair-snapshot',
  'repair',
  'stats',
];

export interface TestHookRoute {
  boardId: string;
  action: TestHookAction;
  params: URLSearchParams;
}

/** Parse `/__test/boards/:boardId/<action>`; null when the path is not a hook. */
export function matchTestHook(pathname: string, params: URLSearchParams): TestHookRoute | null {
  if (!pathname.startsWith('/__test/boards/')) return null;
  const rest = pathname.slice('/__test/boards/'.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const boardId = rest.slice(0, slash);
  const action = rest.slice(slash + 1) as TestHookAction;
  if (!ACTIONS.includes(action)) return null;
  return { boardId, action, params };
}

/** What the hooks may ask the room to do. Implemented by `BoardRoom`. */
export interface TestHookTarget {
  testSeed(count: number): { notes: number; updates: number; snapshotChunks: number };
  testCompact(): { snapshotChunks: number };
  testCorruptSnapshot(): { chunks: number };
  testRepairSnapshot(): { chunks: number };
  testStats(): Record<string, unknown>;
}

export async function runTestHook(
  target: TestHookTarget,
  route: TestHookRoute,
): Promise<Response> {
  switch (route.action) {
    case 'seed': {
      const count = Number(route.params.get('notes') ?? '25');
      if (!Number.isFinite(count) || count < 1 || count > 5000) {
        return json({ error: 'notes must be between 1 and 5000' }, 400);
      }
      return json(target.testSeed(count));
    }
    case 'compact':
      return json(target.testCompact());
    case 'corrupt-snapshot':
      return json(target.testCorruptSnapshot());
    // `repair` is the name used in the story tasks; both spell the same thing.
    case 'repair-snapshot':
    case 'repair':
      return json(target.testRepairSnapshot());
    case 'stats':
      return json(target.testStats());
  }
}

/**
 * Bytes that cannot be a Yjs update: a varint state-vector length of ~2^35
 * followed by far too little data, so the decoder runs off the end and throws.
 */
export function undecodableBytes(original: Uint8Array): Uint8Array {
  const out = new Uint8Array(original.length + 5);
  out.set([0xff, 0xff, 0xff, 0xff, 0x7f], 0);
  out.set(original.subarray(0, Math.min(original.length, 64)), 5);
  return out;
}

/** Realistic retro-board text, used to seed boards of any size. */
const PHRASES = [
  'Shipping the weekly build felt good',
  'Investigated the flaky sync test for two days and learned a lot about CRDTs',
  'Drag lag on big boards',
  'Would like a keyboard shortcut for a new note',
  'Pairing worked well',
  'Colour coding notes by theme helped the retro',
  'The board took a while to open this morning, worth profiling',
  'Documentation for the storage format is thin',
  'Loved how concurrent edits just merged',
  'Notes overlapping in the top-left corner are hard to reach',
];

/** Deterministic text of 10-300 characters for note `index`. */
export function phraseFor(index: number): string {
  const base = `${PHRASES[index % PHRASES.length]} `;
  const repeats = 1 + (index % 6);
  let text = base.repeat(repeats).trim();
  if (text.length > 300) text = text.slice(0, 300);
  return text;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
