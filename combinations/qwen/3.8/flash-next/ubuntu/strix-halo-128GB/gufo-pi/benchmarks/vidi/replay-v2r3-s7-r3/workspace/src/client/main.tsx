import React from 'react';
import ReactDOM from 'react-dom/client';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

function Root() {
  const route = useRoute();
  if (route.name === 'home') return <HomePage />;
  if (route.name === 'board') return <BoardPage id={route.id} />;
  return <NotFoundPage />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
