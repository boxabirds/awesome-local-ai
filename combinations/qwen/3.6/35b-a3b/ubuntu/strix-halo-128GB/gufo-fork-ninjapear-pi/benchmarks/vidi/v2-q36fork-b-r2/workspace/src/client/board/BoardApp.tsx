import * as React from 'react';
import * as Y from 'yjs';
import { screenToWorld } from '../canvas/camera';
import { useCamera } from '../canvas/useCamera';
import { createSticky, setStickyColor, deleteObject, moveObject, bringToFront } from '../../shared/board-model';
import { STICKY_SIZE_WORLD } from '../../shared/config';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { Toolbar } from './Toolbar';
import { NoteToolbar } from '../objects/NoteToolbar';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { useVidi6TestHook } from '../testHooks';

/** Props for the BoardApp — parameterises which board to connect to. */
export interface BoardAppProps {
  /** The board ID (22-char base64url string). */
  boardId: string;
}

/** Full board application for a single board. */
export function BoardApp(props: BoardAppProps): React.JSX.Element {
  const [viewportSize, setViewportSize] = React.useState<{ width: number; height: number }>({
    width: window.innerWidth || 1280,
    height: window.innerHeight || 800,
  });

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

  // ---- Connect to durable object ----
  const { doc, snapshots, connectionState, ConnectionStatus: CS } = useBoardDoc(
    props.boardId,
  );

  const hook = useCamera(viewportSize);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection(doc);

  // Hook into camera state for e2e test assertions
  useVidi6TestHook(hook.setRawCamera);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  const handleCreateStickyAtWorld = React.useCallback(
    (worldPoint: { x: number; y: number }) => {
      const id = createSticky(doc, worldPoint);
      if (id) startEdit(id);
    },
    [doc, startEdit],
  );

  // Listen for window-level create-sticky event (emitted by toolbar)
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
      if (selectedId === id) select(null);
    },
    [doc, selectedId, select],
  );

  const handleMove = React.useCallback(
    (id: string, wx: number, wy: number): boolean => moveObject(doc, id, wx, wy),
    [doc],
  );

  const handleBringToFront = React.useCallback(
    (id: string): boolean => bringToFront(doc, id),
    [doc],
  );

  // Window-level keyboard shortcuts
  React.useEffect(() => {
    const handleWindowKeyDown = (e: KeyboardEvent) => {
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

  // Ctrl/Cmd zoom shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (!ctrlOrMeta) return;
      switch (e.key) {
        case '=': case '+': case 'Equal': e.preventDefault(); hook.zoomIn(); break;
        case '-': case 'Minus': e.preventDefault(); hook.zoomOut(); break;
        case '0': e.preventDefault(); hook.reset(); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hook]);

  // Render viewport
  return (
    <div ref={rootRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* Connection status badge */}
      <CS state={connectionState} />

      {/* Toolbar (top-left) */}
      <Toolbar onCreateSticky={() => handleCreateStickyAtWorld(screenToWorld(hook.camera, {
        x: viewportSize.width / 2,
        y: viewportSize.height / 2,
      }))} />

      {/* Main canvas */}
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

      {/* Note toolbar (appears near selected sticky) */}
      {selectedId && !editingId && (() => {
        const note = snapshots.find((s) => s.id === selectedId);
        if (!note) return null;
        const cx = note.x + STICKY_SIZE_WORLD / 2;
        const cy = note.y - 40;
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

      {/* Zoom controls (bottom-right) */}
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


