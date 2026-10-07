// Pre-warms the Vite dev server's on-demand module transforms before any
// test runs. The WebSocket for board sync is served by the Vite plugin on
// the same port (see vite-plugin-board-sync.ts).

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const PORT = 28432;
const BASE = `http://127.0.0.1:${PORT}`;
const __dirname = dirname(fileURLToPath(import.meta.url));

async function waitForServer(url: string, timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() - start > timeoutMs) throw new Error(`dev server not ready: ${url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

export default async function globalSetup(): Promise<void> {
  // Pre-warm the Vite dev server
  await waitForServer(`${BASE}/`);

  const MODULES = [
    '/src/client/main.tsx',
    '/src/client/App.tsx',
    '/src/client/styles.css',
    '/src/client/testHooks.ts',
    '/src/client/router.ts',
    '/src/client/api.ts',
    '/src/client/pages/HomePage.tsx',
    '/src/client/pages/BoardPage.tsx',
    '/src/client/pages/NotFoundPage.tsx',
    '/src/client/pages/state.ts',
    '/src/client/share/SharePanel.tsx',
    '/src/client/canvas/BoardViewport.tsx',
    '/src/client/canvas/ZoomControls.tsx',
    '/src/client/canvas/NavigationHint.tsx',
    '/src/client/canvas/camera.ts',
    '/src/client/canvas/useCamera.ts',
    '/src/client/board/Toolbar.tsx',
    '/src/client/board/useBoardDoc.ts',
    '/src/client/board/useSelection.ts',
    '/src/client/objects/StickyNote.tsx',
    '/src/client/objects/StickyText.ts',
    '/src/client/objects/StickyTextEditor.tsx',
    '/src/client/objects/NoteToolbar.tsx',
    '/src/shared/board-model.ts',
    '/src/shared/config.ts',
    '/src/shared/board-id.ts',
    '/src/shared/protocol.ts',
    '/src/client/sync/connectBoard.ts',
    '/src/client/sync/ConnectionStatus.tsx',
  ];

  await Promise.all(
    MODULES.map(async (m) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const res = await fetch(`${BASE}${m}`);
        if (res.ok) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }),
  );
}
