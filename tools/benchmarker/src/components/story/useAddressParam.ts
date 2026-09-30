// A page's own state kept in its address (#/vidi/s/2?compare=…): read from the page's params, written back with
// history.replaceState. Replacing, not pushing: choosing a metric or a comparison isn't a place to go back to, so
// Back leaves the page, and coming back to it (Back from a page it links to) finds the choice still in its address.
// Setting location.hash instead would fire hashchange, and the router scrolls to the top on every hashchange.
// Used by the story, combination and run pages.
import { useCallback, useEffect, useState } from "react";
import { withParams } from "../../../shared/routes.ts";

/** The address's query parameters, from its hash. */
function hashParams(): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(location.hash.split("?")[1] ?? ""));
}

/** [value, set]: `set(undefined)` removes the parameter; the other parameters are kept. */
export function useAddressParam(params: Record<string, string> | undefined, key: string): [string | undefined, (v: string | undefined) => void] {
  const given = params?.[key];
  const [value, setValue] = useState<string | undefined>(given);
  // A new address (a link, Back, Forward) brings its own value; the router re-renders the page with its params.
  useEffect(() => setValue(given), [given]);
  // The router's params are only as new as the last hashchange; after a replaceState of ours they are stale, so a
  // later hashchange is read from the address itself.
  useEffect(() => {
    const on = () => setValue(hashParams()[key]);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, [key]);
  const set = useCallback((v: string | undefined) => {
    const path = location.hash.split("?")[0] || "#/";
    history.replaceState(history.state, "", withParams(path, { ...hashParams(), [key]: v }));
    setValue(v);
  }, [key]);
  return [value, set];
}
