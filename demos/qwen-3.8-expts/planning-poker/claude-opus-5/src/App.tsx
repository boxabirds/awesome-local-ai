import { useEffect, useState } from "react";
import { Landing } from "./pages/Landing";
import { RoomPage } from "./pages/RoomPage";

const ROOM_PATH_PATTERN = /^\/room\/([a-z0-9]{3}-[a-z0-9]{3}-[a-z0-9]{3})\/?$/;

function roomCodeFromPath(pathname: string): string | null {
  return ROOM_PATH_PATTERN.exec(pathname.toLowerCase())?.[1] ?? null;
}

/** Two routes is not worth a router dependency. */
export function App() {
  const [pathname, setPathname] = useState(location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const code = roomCodeFromPath(pathname);
  return code ? <RoomPage code={code} /> : <Landing />;
}
