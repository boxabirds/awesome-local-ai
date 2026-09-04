import { GameRoom } from "./game";
export { GameRoom };
import { randomId } from "./rules";

export interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
  ASSETS: Fetcher;
}

const GAME_ID_RE = /^[a-z0-9]{4,24}$/;
const GAME_ID_LENGTH = 8;

function gameStub(env: Env, gameId: string) {
  const namespace = env.GAME_ROOM;
  return namespace.get(namespace.idFromName(gameId));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/games" && request.method === "POST") {
      const gameId = randomId(GAME_ID_LENGTH);
      await gameStub(env, gameId).init(gameId);
      return Response.json({ gameId });
    }

    const wsMatch = path.match(/^\/api\/games\/([a-z0-9]{4,24})\/ws$/);
    if (wsMatch) {
      const gameId = wsMatch[1];
      if (!GAME_ID_RE.test(gameId)) {
        return Response.json({ error: "Invalid game id" }, { status: 400 });
      }
      const upgrade = request.headers.get("upgrade");
      if (upgrade?.toLowerCase() !== "websocket") {
        return Response.json({ error: "Expected WebSocket upgrade" }, { status: 400 });
      }
      return gameStub(env, gameId).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;