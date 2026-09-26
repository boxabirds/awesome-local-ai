import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App.tsx';
import { rememberedQuery } from './features/remembered/api.ts';
import { startBootOpen } from './features/workspace/bootOpen.ts';
import { queryClient } from './lib/queryClient.ts';
import { workspaceLoader } from './routes/workspaceLoader.ts';

// Start opening /w#<secret> before React renders, in parallel with the Workspace chunk (async-parallel).
startBootOpen(window.location);
// On Home, fetch this browser's remembered workspaces in parallel with rendering (async-parallel).
if (window.location.pathname === '/') void queryClient.prefetchQuery(rememberedQuery);
// On /w/:id (and /w/:id/project/:pid), the list, counts and projects start now, in parallel with the route
// chunk and the workspace GET.
const idRoute = /^\/w\/([^/]+)(?:\/project\/([^/]+))?$/.exec(window.location.pathname);
if (idRoute) {
  const projectId = idRoute[2] === undefined ? undefined : decodeURIComponent(idRoute[2]);
  workspaceLoader({ params: { workspaceId: decodeURIComponent(idRoute[1]!), projectId } });
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
