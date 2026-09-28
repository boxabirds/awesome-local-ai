import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { handleTestHook } from './test-hooks';
import { createBoard, type Limiter } from './create-board';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  BOARD_CREATE_LIMITER?: Limiter;
  TEST_HOOKS?: string;
}

// Simple in-memory rate limiter for local dev (wrangler doesn't support ratelimits locally)
class MemoryLimiter implements Limiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private limitPer = 10, private periodMs = 60_000) {}
  async limit({ key }: { key: string }): Promise<{ success: boolean }> {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt < now) {
      this.hits.set(key, { count: 1, resetAt: now + this.periodMs });
      return { success: true };
    }
    entry.count++;
    return { success: entry.count <= this.limitPer };
  }
  reset() { this.hits.clear(); }
}
export const localLimiter = new MemoryLimiter();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // POST /api/test/reset-rate-limit (resets in-memory limiter used in local dev when native ratelimits unavailable)
    if (url.pathname === '/api/test/reset-rate-limit' && request.method === 'POST') {
      if (env.TEST_HOOKS === '1') localLimiter.reset();
      return new Response('ok');
    }

    // POST /api/boards — create a new board
    if (url.pathname === '/api/boards' && request.method === 'POST') {
      const visitorKey = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
      const result = await createBoard({ BOARD_ROOM: env.BOARD_ROOM, BOARD_CREATE_LIMITER: env.BOARD_CREATE_LIMITER ?? localLimiter }, visitorKey);
      if (result.ok) {
        return new Response(JSON.stringify({ id: result.id }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (result.reason === 'rate_limited') {
        return new Response(JSON.stringify({ error: 'rate_limited' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'create_failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Other methods on /api/boards → 405
    if (url.pathname === '/api/boards') {
      return new Response(null, { status: 405 });
    }

    // GET /api/boards/:id — check board existence
    if (url.pathname.startsWith('/api/boards/') && request.method === 'GET') {
      const boardId = url.pathname.slice('/api/boards/'.length);

      // Malformed ids get 404 without touching the DO namespace
      if (!isValidBoardId(boardId)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId) as unknown as { exists(): Promise<boolean> };
      const exists = await stub.exists();

      if (exists) {
        return new Response(JSON.stringify({ id: boardId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Route /api/rooms/:boardId to the BoardRoom Durable Object
    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.slice('/api/rooms/'.length);

      // Validate the board id — 404 for invalid (was 400 in story 3)
      if (!isValidBoardId(boardId)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Check for WebSocket upgrade header
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      // Forward to the Durable Object
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const roomStub = env.BOARD_ROOM.get(doId);
      return roomStub.fetch(request);
    }

    // Test hooks (only available when TEST_HOOKS=1 in the environment)
    const testHookResponse = await handleTestHook(request, { ...env, localLimiter });
    if (testHookResponse) return testHookResponse;

    // Everything else: serve static assets (SPA fallback handled by wrangler config)
    return env.ASSETS.fetch(request);
  },
};

export { BoardRoom };
