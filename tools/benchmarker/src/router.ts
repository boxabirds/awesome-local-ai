import { useEffect, useState } from "react";
import { parseRoute, type Route } from "../shared/routes.ts";

/** The page the address names; follows the back and forward buttons and every link. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => { setRoute(parseRoute(location.hash)); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
