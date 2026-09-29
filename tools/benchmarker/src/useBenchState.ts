import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { State } from "../shared/types.ts";

const POLL_MS = 5_000;
/** No successful refresh for this long: the page is stale and says so. */
export const STALE_S = 20;
const TICK_MS = 1_000;

const SCRIPT_SRC = /<script[^>]+src="([^"]+)"/;
let reloading = false;

/** Reload onto the server's newer build, but only once its page and script both load: a reload
 * while the server restarts or `vite build` rewrites dist/ lands on an error page that never retries. */
async function reloadWhenLoadable() {
  if (reloading) return;
  reloading = true;
  try {
    const page = await fetch("/", { cache: "no-store" });
    if (!page.ok) return;
    const src = SCRIPT_SRC.exec(await page.text())?.[1];
    if (!src || !(await fetch(src, { cache: "no-store" })).ok) return;
    location.reload();
  } catch {
    // not loadable yet: the next poll tries again
  } finally {
    reloading = false;
  }
}

async function fetchState(url: string): Promise<State> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as State;
}

/** The server's state, polled; plus when it last arrived and whether it is now too old. */
export function useBenchState() {
  const lastOk = useRef<number | null>(null);
  const { data, error } = useSWR("/api/state", fetchState, {
    refreshInterval: POLL_MS,
    revalidateOnFocus: true,
    onSuccess(next) {
      lastOk.current = Date.now();
      // The server serves a newer build than this page: reload to run it.
      if (next.buildId !== "dev" && next.buildId !== __BUILD_ID__) void reloadWhenLoadable();
    },
  });
  const now = useNow();
  const shownAt = useShownAt();
  const age = lastOk.current === null ? null : (now - lastOk.current) / 1000;
  // A background tab doesn't poll, so old data there is expected, not a fault. Once shown, it
  // refetches at once; it is stale only if that and the polls after it fail for STALE_S.
  const failingFor = lastOk.current === null || shownAt === null ? null : (now - Math.max(lastOk.current, shownAt)) / 1000;
  const stale = shownAt === null ? false : failingFor === null ? Boolean(error) : failingFor > STALE_S;
  // The server's clock now: its time when the state was made, plus how long ago that arrived here.
  const serverNow = data && lastOk.current !== null ? data.now + (now - lastOk.current) / 1000 : null;
  return { data, error: error ? String(error.message ?? error) : "", age, stale, serverNow };
}

/** When the tab was last shown (null while it is hidden). */
function useShownAt(): number | null {
  const visibleNow = () => (document.visibilityState === "visible" ? Date.now() : null);
  const [shownAt, setShownAt] = useState(visibleNow);
  useEffect(() => {
    const onChange = () => setShownAt(visibleNow());
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return shownAt;
}

/** The current time, re-rendering every second so ages keep counting between polls. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  return now;
}
