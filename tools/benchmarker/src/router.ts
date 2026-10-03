// The page the address names, and where the window was scrolled on each page the reader has been to. A link
// followed is a new place and starts at the top; Back and Forward return to a place and to the position the reader
// left it at. The browser's own restoration is switched off: with the hash as the address it fires before the page
// has rendered, and on a page that loads its data after render it lands on a page that is still short. Instead each
// history entry is given a key, the position is saved under the key when the reader leaves, and restoring is tried
// after every render until the page is tall enough to reach it or the reader goes somewhere new.
import { useEffect, useState } from "react";
import { parseRoute, type Route } from "../shared/routes.ts";

const KEY = "navKey";
/** Where the reader was on each entry, by its key. A reload is a new place, so memory is enough. */
const positions = new Map<string, number>();
let current: string = "";
/** The position still to restore on the entry the reader has just come back to. */
let pending: number | null = null;
let seq = 0;

const keyOf = (): string | undefined => (history.state as { [KEY]?: string } | null)?.[KEY];

/** The current entry's key, assigned when it has none (a link followed, the first page, an assignment to the hash). */
function stamp(): { key: string; fresh: boolean } {
  const had = keyOf();
  if (had) return { key: had, fresh: false };
  const key = `${Date.now().toString(36)}-${(seq += 1)}`;
  history.replaceState({ ...(history.state as object | null), [KEY]: key }, "");
  return { key, fresh: true };
}

/** Scroll to the pending position when the page can reach it; keep it pending otherwise. */
export function restoreScroll(): void {
  if (pending === null) return;
  const reach = document.documentElement.scrollHeight - innerHeight;
  if (reach < pending) return;
  window.scrollTo(0, pending);
  pending = null;
}

/** The page the address names; follows the back and forward buttons and every link. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    current = stamp().key;
    const on = () => {
      positions.set(current, scrollY);
      const { key, fresh } = stamp();
      current = key;
      pending = fresh ? null : positions.get(key) ?? 0;
      setRoute(parseRoute(location.hash));
      if (fresh) window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  // After each render of a page the reader came back to, try the position again: the page may have grown.
  useEffect(() => { restoreScroll(); });
  return route;
}
