import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { rememberedQuery } from './features/remembered/api';
import { startBootOpen } from './features/workspace/bootOpen';
import { preloadWorkspaceRoute } from './features/workspace/preloadWorkspaceRoute';
import { queryClient } from './lib/queryClient';
import { workspaceLoader } from './routes/workspaceLoader';

// Start opening /w#<secret> now, in parallel with the Workspace route chunk download.
startBootOpen(window.location);
// On Home, fetch this browser's workspaces in parallel with the first render, and warm the
// Workspace route chunk once the page is idle, so opening one from the list shows its name at once.
if (window.location.pathname === '/') {
  void queryClient.prefetchQuery(rememberedQuery);
  if ('requestIdleCallback' in window) window.requestIdleCallback(preloadWorkspaceRoute);
  else setTimeout(preloadWorkspaceRoute, 0);
}

// Opening /w/:workspaceId: the Inbox list and counts load in parallel with the route chunk.
const byId = /^\/w\/([^/]+)\/?$/.exec(window.location.pathname);
if (byId) workspaceLoader({ params: { workspaceId: decodeURIComponent(byId[1]!) } });

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
