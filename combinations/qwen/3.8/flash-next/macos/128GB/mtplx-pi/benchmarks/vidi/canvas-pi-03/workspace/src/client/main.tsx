import { type ReactElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import './styles.css';

const container = document.getElementById('root');

/** The router root: the current route decides the page. No board is created at
 * an unknown address (share.not_found), and `/` no longer redirects to a
 * random id — it is the home page with Create a board. */
function Root(): ReactElement {
  const route = useRoute();
  if (route.name === 'home') return <HomePage />;
  if (route.name === 'board') return <BoardPage key={route.id} id={route.id} />;
  return <NotFoundPage />;
}

if (container) {
  createRoot(container).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}