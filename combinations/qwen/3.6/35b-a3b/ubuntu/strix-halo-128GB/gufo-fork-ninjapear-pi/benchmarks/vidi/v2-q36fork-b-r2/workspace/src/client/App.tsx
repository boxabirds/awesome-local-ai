import * as React from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { NoteToolbar } from './objects/NoteToolbar';
import type { Size, Camera } from './canvas/camera';
import { screenToWorld } from './canvas/camera';
import { createSticky, setStickyColor, deleteObject } from '../shared/board-model';
import { STICKY_SIZE_WORLD } from '../shared/config';
import { useVidi6TestHook } from './testHooks';

export default function App(): React.JSX.Element {
  const [viewportSize, setViewportSize] = React.useState<Size>({ width: 1280, height: 800 });

  // ResizeObserver for viewport size changes
  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setViewportSize({ width, height });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { doc, snapshots } = useBoardDoc();
  const hook = useCamera(viewportSize);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  // Test hook: window.__vidi6.setCamera() → updates the camera state
  useVidi6TestHook(hook.setRawCamera);

  // --- Handlers ---

  const handleCreateStickyAtWorld = React.useCallback(
    (worldPoint: { x: number; y: number }) => {
      const id = createSticky(doc, worldPoint);
      if (id) {
        startEdit(id);
      }
    },
    [doc, startEdit],
  );

  // Listen for double-click create events from BoardViewport
  React.useEffect(() => {
    const handler = (e: Event) => {
      const pt = (e as CustomEvent).detail as { x: number; y: number };
      handleCreateStickyAtWorld(pt);
    };
    window.addEventListener('vidi6:createSticky', handler);
    return () => window.removeEventListener('vidi6:createSticky', handler);
  }, [handleCreateStickyAtWorld]);

  const handleSelect = React.useCallback(
    (id: string) => {
      if (editingId === id) return;
      select(id);
    },
    [editingId, select],
  );

  const handleSetColor = React.useCallback(
    (color: string) => {
      if (selectedId && editingId !== selectedId) {
        setStickyColor(doc, selectedId, color);
      }
    },
    [doc, selectedId, editingId],
  );

  const handleDelete = React.useCallback(
    (id: string) => {
      deleteObject(doc, id);
      if (selectedId === id) {
        select(null);
      }
    },
    [doc, selectedId, select],
  );

  const handleMove = React.useCallback(
    (id: string, worldX: number, worldY: number): boolean => {
      return moveObject(doc, id, worldX, worldY);
    },
    [doc],
  );

  const handleBringToFront = React.useCallback(
    (id: string): boolean => {
      return bringToFront(doc, id);
    },
    [doc],
  );

  // Window-level keyboard shortcuts (Enter/Delete/Backspace)
  React.useEffect(() => {
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      // Ignore if inside an input element
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;

      if (e.key === 'Enter' && selectedId && !editingId) {
        e.preventDefault();
        startEdit(selectedId);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId) {
        e.preventDefault();
        handleDelete(selectedId);
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [selectedId, editingId, startEdit, handleDelete]);

  // Ctrl/Cmd keyboard shortcuts (zoom)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (!ctrlOrMeta) return;

      switch (e.key) {
        case '=':
        case '+':
        case 'Equal':
          e.preventDefault();
          hook.zoomIn();
          break;
        case '-':
        case 'Minus':
          e.preventDefault();
          hook.zoomOut();
          break;
        case '0':
          e.preventDefault();
          hook.reset();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hook]);

  return (
    <div ref={rootRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <Toolbar onCreateSticky={() => handleCreateStickyAtWorld(screenToWorld(hook.camera, {
        x: viewportSize.width / 2,
        y: viewportSize.height / 2,
      }))} />
      <BoardViewport
        camera={hook.camera}
        useCameraHook={hook}
        snapshosts={snapshots}
        doc={doc}
        selectedId={selectedId}
        editingId={editingId}
        onSelect={handleSelect}
        onStartEdit={startEdit}
        onEndEdit={endEdit}
        onMove={handleMove}
        onBringToFront={handleBringToFront}
        onDelete={handleDelete}
      />
      {/* Render NoteToolbar for the selected note */}
      {selectedId && !editingId && (() => {
        const note = snapshots.find((s) => s.id === selectedId);
        if (!note) return null;
        // Position in screen space above the note center
        const cx = (note.x + STICKY_SIZE_WORLD / 2);
        const cy = (note.y - 40);
        const screenX = (cx - hook.camera.x) * hook.camera.zoom;
        const screenY = (cy - hook.camera.y) * hook.camera.zoom;
        return (
          <div
            style={{
              position: 'fixed',
              left: `${screenX}px`,
              top: `${screenY}px`,
              transform: 'translate(-50%, 0)',
              zIndex: 100,
              pointerEvents: 'auto',
            }}
          >
            <NoteToolbar
              color={note.color as any}
              onColor={handleSetColor}
              onDelete={() => handleDelete(note.id)}
            />
          </div>
        );
      })()}
      <ZoomControls
        zoomPercent={hook.percent}
        canZoomIn={hook.canZoomIn}
        canZoomOut={hook.canZoomOut}
        onZoomIn={hook.zoomIn}
        onZoomOut={hook.zoomOut}
        onReset={hook.reset}
      />
      <NavigationHint visible={hook.hasNavigated} />
    </div>
  );
}

// Re-export board-model functions
import { moveObject, bringToFront } from '../shared/board-model';
