/**
 * Which page this screen is (`share.router`, design `router.route_model`).
 *
 * Three routes, decided by the path alone:
 *
 *   `/`            → home
 *   `/b/:boardId`  → board, when `boardId` passes `isValidBoardId`
 *   anything else  → board not found
 *
 * There is no client-side creation left: `/` is a page with a button, not a
 * board. Story 3's "visiting a board creates it" is gone — that is exactly what
 * made an unknown link silently invent a board.
 *
 * `AppRouter` renders one of the three pages and nothing else. It owns the URL
 * (a `popstate` listener plus `navigate`, which writes history and re-parses),
 * and it never renders board content itself.
 */

import { useCallback, useEffect, useState } from "react";
import { isValidBoardId } from "../shared/board-id";
import { HOME_PATH, boardIdFromPath, boardPath } from "./routing";
import { BoardPage } from "./pages/BoardPage";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";

export { boardPath, HOME_PATH };
export type Route = { name: "home" } | { name: "board"; boardId: string } | { name: "not_found" };

/** The route a pathname means. Never throws, never yields "board" for a malformed id. */
export function parseRoute(pathname: string): Route {
  if (pathname === HOME_PATH || pathname === "") return { name: "home" };

  const boardId = boardIdFromPath(pathname);
  if (boardId !== null && isValidBoardId(boardId)) return { name: "board", boardId };

  return { name: "not_found" };
}

/** The path a board lives at is `boardPath`, re-exported from `routing.ts` above. */
export interface RouteState {
  route: Route;
  /** The pathname the route was parsed from — the not-found page displays it. */
  pathname: string;
  /** Writes history and re-parses. `replace: true` for the home → board hop. */
  navigate: (pathname: string, options?: { replace?: boolean }) => void;
}

/** The router's whole state: the current route, and the only way to change it. */
export function useRoute(): RouteState {
  const read = useCallback(
    () => ({ pathname: window.location.pathname, route: parseRoute(window.location.pathname) }),
    [],
  );

  const [location, setLocation] = useState(read);

  useEffect(() => {
    const onPopState = () => setLocation(read());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [read]);

  const navigate = useCallback(
    (pathname: string, options: { replace?: boolean } = {}) => {
      if (options.replace) window.history.replaceState(null, "", pathname);
      else window.history.pushState(null, "", pathname);
      setLocation({ pathname, route: parseRoute(pathname) });
    },
    [],
  );

  return { ...location, navigate };
}

/**
 * The app's page chooser (`11-app-router.test.tsx` renders this).
 *
 * It renders exactly one page for the current route; everything about a board —
 * its existence check, its share panel, its canvas — belongs to `BoardPage`.
 */
export function AppRouter() {
  const { route, pathname, navigate } = useRoute();

  if (route.name === "home") return <HomePage navigate={navigate} />;
  // `navigate` is passed down because the Board-not-found page a board link can
  // land on has a New board button, and a button that cannot navigate is a lie.
  if (route.name === "board") return <BoardPage boardId={route.boardId} navigate={navigate} />;
  return <NotFoundPage pathname={pathname} navigate={navigate} />;
}
