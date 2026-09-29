import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');

function Root() {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      return <BoardPage id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
