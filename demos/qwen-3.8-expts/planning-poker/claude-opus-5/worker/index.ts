import { CUSTOM_DECK_ID, DECKS } from "../shared/decks";
import { LIMITS } from "../shared/protocol";
import { cleanText } from "../shared/sanitize";
import type { Env } from "./env";
import { PokerRoom } from "./room";
import { generateRoomCode, isValidRoomCode, registerRoom, resolveDeckId } from "./rooms";
import {
  corsHeaders,
  errorResponse,
  finalize,
  json,
  newRequestId,
  validateRequest,
} from "./security";

export { PokerRoom };

const API_PREFIX = "/api";
const HISTORY_PAGE_SIZE = 50;

/* ----------------------------------- routing ----------------------------------- */

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.slice(API_PREFIX.length) || "/";
  const segments = path.split("/").filter(Boolean);

  if (path === "/health") return healthResponse(env);

  if (path === "/decks") {
    return json({
      decks: DECKS.map((d) => ({
        id: d.id,
        label: d.label,
        values: d.values,
        meta: d.meta ?? [],
      })),
      customDeckId: CUSTOM_DECK_ID,
    });
  }

  if (segments[0] === "rooms") {
    if (segments.length === 1 && request.method === "POST") return createRoom(request, env);

    const code = (segments[1] ?? "").toLowerCase();
    if (!isValidRoomCode(code)) {
      return errorResponse(400, "bad_room_code", "That room code is not valid");
    }

    const action = segments[2];
    if (action === "ws") return connectToRoom(request, env, code);
    if (action === "history") return roomHistory(env, code);
    if (!action && request.method === "GET") return roomSummary(env, code);
  }

  return errorResponse(404, "not_found", "No such endpoint");
}

function healthResponse(env: Env): Response {
  return json({
    status: "ok",
    version: env.APP_VERSION,
    environment: env.ENVIRONMENT,
    git_sha: env.GIT_SHA,
    deployed_at: env.DEPLOYED_AT,
    database: env.DB ? "bound" : "unbound",
  });
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  let body: { name?: string; deckId?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse(400, "bad_json", "Expected a JSON body");
  }

  const code = generateRoomCode();
  const name = cleanText(body.name, LIMITS.MAX_ROOM_NAME_LENGTH) || "Planning session";
  const deckId = resolveDeckId(body.deckId);

  await registerRoom(env, code, name, deckId);
  return json({ code, name, deckId }, { status: 201 });
}

async function roomSummary(env: Env, code: string): Promise<Response> {
  const stub = env.POKER_ROOM.get(env.POKER_ROOM.idFromName(code));
  const response = await stub.fetch(`https://room/${code}/summary`);
  const summary = (await response.json()) as { playerCount: number; name: string };
  return json({ code, ...summary });
}

async function roomHistory(env: Env, code: string): Promise<Response> {
  if (!env.DB) return json({ code, rounds: [] });

  const result = await env.DB.prepare(
    `SELECT round_number, issue_key, issue_title, deck_id, votes_json,
            average, consensus, voter_count, created_at
       FROM rounds
      WHERE room_code = ?
      ORDER BY id DESC
      LIMIT ?`,
  )
    .bind(code, HISTORY_PAGE_SIZE)
    .all();

  const rounds = (result.results ?? []).map((row) => ({
    roundNumber: row.round_number,
    issueKey: row.issue_key,
    issueTitle: row.issue_title,
    deckId: row.deck_id,
    votes: JSON.parse(String(row.votes_json ?? "[]")),
    average: row.average,
    consensus: Boolean(row.consensus),
    voterCount: row.voter_count,
    createdAt: row.created_at,
  }));

  return json({ code, rounds });
}

function connectToRoom(request: Request, env: Env, code: string): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return Promise.resolve(errorResponse(426, "upgrade_required", "Expected a WebSocket upgrade"));
  }
  const url = new URL(request.url);
  url.searchParams.set("code", code);
  const stub = env.POKER_ROOM.get(env.POKER_ROOM.idFromName(code));
  return stub.fetch(new Request(url, request));
}

/* ----------------------------------- entry ----------------------------------- */

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestId = newRequestId();
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env.WEB_APP_URL) });
    }

    // Everything that is not the API is the single-page app.
    if (!url.pathname.startsWith(API_PREFIX) && url.pathname !== "/health") {
      return env.ASSETS.fetch(request);
    }

    const invalid = await validateRequest(request);
    if (invalid) return finalize(invalid, requestId);

    // A 101 response is immutable: it cannot be re-wrapped with extra headers.
    const isWebSocket = request.headers.get("Upgrade") === "websocket";

    try {
      const apiPath = url.pathname === "/health" ? `${API_PREFIX}/health` : url.pathname;
      const response = await handleApi(
        request,
        env,
        new URL(apiPath + url.search, url.origin),
      );
      if (isWebSocket) return response;

      const withCors = new Response(response.body, response);
      for (const [key, value] of Object.entries(corsHeaders(env.WEB_APP_URL))) {
        withCors.headers.set(key, value);
      }
      return finalize(withCors, requestId);
    } catch (error) {
      ctx.waitUntil(
        (async () => {
          console.error("unhandled_error", {
            requestId,
            path: url.pathname,
            error: String(error),
          });
        })(),
      );
      return finalize(
        errorResponse(500, "internal_error", `Something went wrong (${requestId})`),
        requestId,
      );
    }
  },
} satisfies ExportedHandler<Env>;
