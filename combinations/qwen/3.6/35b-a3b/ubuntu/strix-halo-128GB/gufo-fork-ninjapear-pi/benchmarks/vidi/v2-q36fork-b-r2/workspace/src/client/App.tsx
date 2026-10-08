import * as React from 'react';
import { useRoute, navigate, setupRouter } from './router';
import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';

// Shared UndoController ref for the current board (destroyed on board change)
let _undoController: ReturnType<typeof import('./board/undo').createUndo> | null = null;

/** Root App — renders the appropriate page based on the current route. */
export default function App(): React.JSX.Element {
  const [currentRoute, setCurrentRoute] = React.useState(() => {
    // Parse initial route from location
    const pathname = window.location.pathname;
    if (pathname === '/' || pathname === '') return { name: 'home' as const };
    const match = pathname.match(/^\/b\/(.+)$/);
    if (match) return { name: 'board' as const, id: match[1] };
    if (pathname.startsWith('/b/')) return { name: 'not_found' as const };
    return { name: 'home' as const };
  });

  // Set up popstate listener for back/forward navigation
  React.useEffect(() => {
    setupRouter((route) => setCurrentRoute(route));
  }, []);

  // Handle clicks on "New board" / "Go home" links that change URL via history.pushState
  React.useEffect(() => {
    const handler = () => {
      setCurrentRoute({ name: 'home' });
      if (window.location.pathname.startsWith('/b/')) {
        // Check if it's a valid board ID
        const match = window.location.pathname.match(/^\/b\/([A-Za-z0-9_-]{22})$/);
        if (match) {
          setCurrentRoute({ name: 'board', id: match[1] });
        } else if (window.location.pathname.startsWith('/b/')) {
          setCurrentRoute({ name: 'not_found' });
        }
      }
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  // Render the correct page
  switch (currentRoute.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      return <BoardPage />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
