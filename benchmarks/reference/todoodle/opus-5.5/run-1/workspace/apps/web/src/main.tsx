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
// On /w/:id, the Inbox list and counts start now, in parallel with the route chunk and the workspace GET.
const idRoute = /^\/w\/([^/]+)$/.exec(window.location.pathname);
if (idRoute) workspaceLoader({ params: { workspaceId: decodeURIComponent(idRoute[1]!) } });

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
