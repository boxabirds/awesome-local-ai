import * as React from 'react';
import * as Y from 'yjs';
import { screenToWorld } from '../canvas/camera';
import { useCamera } from '../canvas/useCamera';
import { createSticky } from '../../shared/board-model';
import { STICKY_SIZE_WORLD } from '../../shared/config';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { Toolbar } from './Toolbar';
import { NoteToolbar } from '../objects/NoteToolbar';
import { SelectionBar } from './SelectionBar';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { useVidi6TestHook } from '../testHooks';
import { useTransformGesture } from './useTransformGesture';
import { useBoardKeys } from './useBoardKeys';
import { createUndo } from './undo';
import { useUndo } from './useUndo';
import type { UndoController } from './undo';

export interface BoardAppProps {
  boardId: string;
}

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
  const { doc, snapshots, connectionState, canEdit, ConnectionStatus: CS } = useBoardDoc(
    props.boardId,
  );

  const hook = useCamera(viewportSize);
  const selection = useSelection(snapshots, doc);

  // ---- Undo controller (story 8) ----
  const controllerRef = React.useRef<UndoController | null>(null);

  // Create/destroy controller when board changes
  React.useEffect(() => {
    // Destroy previous controller
    controllerRef.current?.destroy();
    controllerRef.current = null;

    // Only create when we have a real doc
    if (doc && connectionState === 'connected') {
      controllerRef.current = createUndo(doc);
    }

    return () => {
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, [props.boardId]); // destroy on board change

  // Clean up controller when unmounting (session only)
  React.useEffect(() => {
    return () => {
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, []);

  const canEditBool = !!canEdit;
  const undoProps = useUndo(controllerRef.current, canEditBool);
  const boundary = React.useCallback(() => {
    controllerRef.current?.boundary();
  }, []);

  // Hook into camera state for e2e test assertions
  useVidi6TestHook(hook.setRawCamera);

  // ---- Gesture hooks ----
  const gesture = useTransformGesture({
    doc: doc!,
    camera: hook.camera,
    selection,
    snapshot: snapshots,
    canEdit: !!canEdit,
    onGestureStart: boundary,
    onGestureEnd: boundary,
  });

  // Keyboard handler
  useBoardKeys({
    doc: doc!,
    selection,
    snapshot: snapshots,
    canEdit: !!canEdit,
    editingId: selection.editingId,
    undo: undoProps.undo,
    redo: undoProps.redo,
    canUndo: undoProps.canUndo,
    canRedo: undoProps.canRedo,
  });

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  const handleCreateStickyAtWorld = React.useCallback(
    (worldPoint: { x: number; y: number }) => {
      const id = createSticky(doc, worldPoint);
      if (id) selection.startEdit(id);
    },
    [doc],
  );

  React.useEffect(() => {
    const handler = (e: Event) => {
      const pt = (e as CustomEvent).detail as { x: number; y: number };
      handleCreateStickyAtWorld(pt);
    };
    window.addEventListener('vidi6:createSticky', handler);
    return () => window.removeEventListener('vidi6:createSticky', handler);
  }, [handleCreateStickyAtWorld]);

  // Handle additive selection from marquee
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ids = (e as CustomEvent).detail as string[];
      if (ids.length > 0) {
        selection.setMany(ids, true);
      }
    };
    window.addEventListener('vidi6:addSelection', handler);
    return () => window.removeEventListener('vidi6:addSelection', handler);
  }, [selection]);

  // Handle clear selection from empty click
  React.useEffect(() => {
    const handler = () => {
      selection.clear();
    };
    window.addEventListener('vidi6:clearSelection', handler);
    return () => window.removeEventListener('vidi6:clearSelection', handler);
  }, [selection]);

  const handleSelect = React.useCallback(
    (id: string) => {
      if (selection.editingId === id) return;
      selection.click(id);
    },
    [selection.editingId],
  );

  const handleSetColor = React.useCallback(
    (_color: string) => {},
    [],
  );

  const handleDeleteSelection = React.useCallback(() => {
    if (doc && selection.ids.size > 0) {
      const idsToDelete = [...selection.ids];
      selection.clear();
      // Delete in a microtask to avoid re-entrant state issues
      Promise.resolve().then(() => {
        import('../../shared/board-model').then(({ deleteObjects }) => {
          deleteObjects(doc, idsToDelete);
        });
      });
    }
  }, [doc, selection.ids, selection]);

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

      {/* Selection bar */}
      <SelectionBar
        ids={selection.ids}
        snapshot={snapshots}
        doc={doc}
        onDelete={handleDeleteSelection}
      />

      {/* Toolbar (top-left) */}
      <Toolbar
        onCreateSticky={() => handleCreateStickyAtWorld(screenToWorld(hook.camera, {
          x: viewportSize.width / 2,
          y: viewportSize.height / 2,
        }))}
        undoProps={undoProps}
      />

      {/* Main canvas */}
      <BoardViewport
        camera={hook.camera}
        useCameraHook={hook}
        snapshosts={snapshots}
        doc={doc}
        selectedIds={selection.ids}
        editingId={selection.editingId}
        onSelect={handleSelect}
        onStartEdit={selection.startEdit}
        onEndEdit={selection.endEdit}
        onMove={undefined}
        onBringToFront={undefined}
        onDelete={undefined}
        onObjectPointerDown={gesture.onObjectPointerDown}
        onHandlePointerDown={gesture.onHandlePointerDown}
        undo={undoProps.undo}
        redo={undoProps.redo}
      />

      {/* Note toolbar (appears near selected sticky — single note only) */}
      {selection.ids.size === 1 && !selection.editingId && (() => {
        const note = snapshots.find((s) => s.id === [...selection.ids][0]);
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
              onDelete={() => {
                if (doc) {
                  const id = note.id;
                  selection.clear();
                  import('../../shared/board-model').then(({ deleteObject: delObj }) => {
                    delObj(doc, id);
                  });
                }
              }}
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
