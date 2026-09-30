import { useRef, useLayoutEffect, useState, useEffect, useCallback } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld, type Camera, type Point } from './canvas/camera';
import { useCamera } from './canvas/useCamera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject, snapshot } from '../shared/board-model';
import { newBoardId } from '../shared/board-id';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit, type ConnectionState } from './sync/connectBoard';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
      doc?: Y.Doc;
      snapshot?(): readonly import('../shared/board-model').StickySnapshot[];
      connectionState?: ConnectionState;
    };
  }
}

/**
 * Reads the board id from the URL path.
 * /b/:boardId → boardId
 * / → redirect to /b/<newBoardId()>
 */
function getBoardIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/b\/([A-Za-z0-9_-]{22})$/);
  return match ? match[1] : null;
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1280, height: 800 });

  // Resolve board id from URL; redirect if at /
  const [boardId] = useState<string>(() => {
    const id = getBoardIdFromPath();
    if (id) return id;
    // Redirect to a new board
    const newId = newBoardId();
    window.history.replaceState(null, '', `/b/${newId}`);
    return newId;
  });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setSize({ width, height });
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStepFn, reset, setCamera } =
    useCamera(size);
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection();

  const [isPanning, setIsPanning] = useState(false);

  const handlePointerDown = (p: { x: number; y: number }) => {
    setIsPanning(true);
    beginPan(p);
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    endPan();
  };

  const handlePointerCancel = () => {
    setIsPanning(false);
    endPan();
  };

  // Editing is disabled only while the board cannot be loaded (story 4):
  // changes made to an unloadable board could not be stored. A transient
  // disconnect ('reconnecting') keeps the board editable — unsaved changes
  // are re-sent on reconnect.
  const editable = canEdit(connectionState);

  // Create a sticky note centred on a viewport point; select and edit it.
  const createStickyAtScreenPoint = useCallback(
    (p: Point) => {
      if (!canEdit(connectionState)) return;
      const world = screenToWorld(camera, p);
      const id = createSticky(doc, world);
      if (id) {
        selection.select(id);
        selection.startEdit(id);
      }
    },
    [camera, doc, selection, connectionState]
  );

  // Toolbar button: create at the centre of the visible board area.
  const createStickyAtCentre = useCallback(() => {
    createStickyAtScreenPoint({ x: size.width / 2, y: size.height / 2 });
  }, [createStickyAtScreenPoint, size]);

  // Keyboard: Enter edits the selected note; Delete/Backspace delete it.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (inField || selection.editingId !== null) return;

      if (e.key === 'Enter') {
        if (selection.selectedId !== null && canEdit(connectionState)) {
          e.preventDefault();
          selection.startEdit(selection.selectedId);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.selectedId !== null && canEdit(connectionState)) {
          e.preventDefault();
          if (deleteObject(doc, selection.selectedId)) {
            selection.select(null);
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [doc, selection, connectionState]);

  // If the selected or edited note disappears from the board (e.g. deleted
  // mid-interaction), clear the local selection state silently.
  useEffect(() => {
    if (
      (selection.selectedId !== null && !notes.some((n) => n.id === selection.selectedId)) ||
      (selection.editingId !== null && !notes.some((n) => n.id === selection.editingId))
    ) {
      selection.select(null);
    }
  }, [notes, selection]);

  // Expose test hook for e2e / component tests
  useEffect(() => {
    window.__vidi6 = { setCamera, doc, snapshot: () => snapshot(doc), connectionState };
    return () => {
      delete window.__vidi6;
    };
  }, [setCamera, doc, connectionState]);

  return (
    <div ref={containerRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={camera}
        isPanning={isPanning}
        onPointerDown={handlePointerDown}
        onPointerMove={panMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={wheel}
        onKeyZoomIn={() => zoomStepFn('in')}
        onKeyZoomOut={() => zoomStepFn('out')}
        onKeyReset={reset}
        onEmptyClick={() => selection.select(null)}
        onCreateSticky={createStickyAtScreenPoint}
      >
        {[...notes]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            z={note.z}
            zoom={camera.zoom}
            selected={selection.selectedId === note.id}
            editing={selection.editingId === note.id}
            editable={editable}
            onSelect={selection.select}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createStickyAtCentre} disabled={!editable} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStepFn('in')}
        onZoomOut={() => zoomStepFn('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
