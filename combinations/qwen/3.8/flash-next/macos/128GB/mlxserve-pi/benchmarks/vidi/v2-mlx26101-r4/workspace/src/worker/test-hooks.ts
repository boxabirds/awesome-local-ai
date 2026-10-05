/**
 * The outside-facing half of the test-only routes.
 *
 * A browser-driven test cannot reach into a Durable Object: it can only make an HTTP request.
 * So the things an end-to-end test has to be able to do to a board — read what is stored, fold
 * the log away, damage the stored board, put it back, fill it with two thousand notes — have
 * addresses here, and those addresses
 * forward to the room's own internal routes (`/x/…` in `board-room.ts`), which is where the
 * storage is actually touched.
 *
 * **Mounted only when `TEST_HOOKS` is `1`.** That value is given on the e2e command line
 * (`wrangler dev --var TEST_HOOKS:1`) and is deliberately absent from `wrangler.jsonc`, so a
 * Worker started any other way does not have these addresses: the request falls through to the
 * client, which answers with the app or a 404, exactly as it does for every other unknown
 * address. What is exposed is damage and repair, not reads of other people's boards: a board id
 * is the only credential in this product, and these routes can destroy the board behind an id
 * that somebody typed correctly, which is why they are not in the shipped configuration at all.
 */
import { isValidBoardId } from '../shared/board-id';
import type { Env } from './board-room';

/** Everything under this path is a test asking a board to do something it would never do itself. */
export const TEST_HOOK_PREFIX = '/__test/';

/** The address of a board's test route, as a browser-driven test writes it. */
export function testHookPath(boardId: string, route: string): string {
  return `${TEST_HOOK_PREFIX}boards/${boardId}/${route}`;
}

/** What the room answers to a GET, and so what a test may GET. Everything else is a POST. */
const READABLE = ['stats', 'lines', 'state'];

/** The routes a test is allowed to ask for, so that this is a list and not a way through. */
const ROUTES = [...READABLE, 'compact', 'corrupt-snapshot', 'repair', 'fail-next', 'seed'];

/**
 * Forward a test request to a board's room, or serve the client when these routes are not mounted.
 *
 * The room is fetched with a request whose address is one of its internal routes, which is the
 * same object a person's connection reaches — so what a test damages is the storage that
 * connection would read, not a copy of it.
 */
export function forwardTestHook(request: Request, env: Env, path: string): Promise<Response> {
  if (env.TEST_HOOKS !== '1') return env.ASSETS.fetch(request);

  const segments = path.slice(TEST_HOOK_PREFIX.length + 'boards/'.length).split('/');
  const [boardId, route, ...rest] = segments;
  const bad = (message: string): Response => new Response(message, { status: 404 });
  if (boardId === undefined || route === undefined || rest.length > 0 || !isValidBoardId(boardId)) {
    return Promise.resolve(bad('That is not a board test address.'));
  }
  if (!ROUTES.includes(route)) {
    return Promise.resolve(bad(`There is no test route called ${route}.`));
  }

  const target = new URL(`https://board-room.internal/x/${route}${new URL(request.url).search}`).href;
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return stub.fetch(
    new Request(target, {
      method: READABLE.includes(route) ? 'GET' : 'POST',
    }),
  );
}
