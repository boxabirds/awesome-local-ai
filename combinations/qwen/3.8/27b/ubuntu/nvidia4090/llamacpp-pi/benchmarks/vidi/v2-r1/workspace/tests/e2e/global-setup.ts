// Pre-warms the Vite dev server's on-demand module transforms before any
// test runs. The first page load of a Playwright run would otherwise trigger
// transforms for the whole module graph, and on a slow/loaded machine that
// can push the app's first render past the test timeout.

const PORT = 28432;
const BASE = `http://127.0.0.1:${PORT}`;

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

// Every source module the app loads, fetched through the dev server so Vite
// transforms (and caches) them up front.
const MODULES = [
  '/src/client/main.tsx',
  '/src/client/App.tsx',
  '/src/client/styles.css',
  '/src/client/testHooks.ts',
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
];

export default async function globalSetup(): Promise<void> {
  await waitForServer(`${BASE}/`);
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
