// The router shell (design "Routing"): `/` is the home page, `/b/:id` is a
// board, anything else — including a `/b/…` whose id is malformed — is the
// Board Not Found page. It holds no board state of its own: when the route
// changes it swaps whole pages, so a board's Yjs doc, connection and rAF loops
// mount and unmount with the page (share.open_link / share.not_found).

import { useEffect, useState } from 'react';
import HomePage from './pages/HomePage.tsx';
import BoardPage from './pages/BoardPage.tsx';
import NotFoundPage from './pages/NotFoundPage.tsx';
import { parseRoute, type Route } from './router.ts';

function currentRoute(): Route {
  return parseRoute(window.location.pathname);
}

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    // `navigateTo` in router.ts fires this for in-app navigations too, so there
    // is one place where a path becomes a page.
    const onPop = () => setRoute(currentRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (route.kind === 'home') return <HomePage />;
  if (route.kind === 'board') return <BoardPage key={route.boardId} boardId={route.boardId} />;
  return <NotFoundPage boardId={route.boardId} />;
}
