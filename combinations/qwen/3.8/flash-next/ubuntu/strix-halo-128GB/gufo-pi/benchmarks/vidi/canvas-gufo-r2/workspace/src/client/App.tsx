import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import { BoardViewport, useBoardCamera } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection, type SelectionState } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { NoteToolbar } from './objects/NoteToolbar';
import { ConnectionStatus } from './sync/ConnectionStatus';
import {
  createSticky,
  deleteObject,
  setStickyColor,
} from '../shared/board-model';

import type { StickyColor } from '../shared/config';
import type { Point } from './canvas/camera';

/** Imperative bridge so callbacks defined inside the viewport can convert
 * screen points to world using the current camera and viewport size. */
interface BoardBridge {
  toWorld(screenPoint: Point): Point;
  viewportCentreWorld(): Point;
}

/** Screen-space chrome over the board: toolbars, zoom control, hint. */
function BoardChrome(props: {
  selection: SelectionState;
  doc: ReturnType<typeof useBoardDoc>['doc'];
  selectedColor: StickyColor | null;
  onCreateSticky(): void;
  connectionState: ReturnType<typeof useBoardDoc>['connectionState'];
}) {
  const { camera, hasNavigated, zoomStep, reset } = useBoardCamera();
  const { selection, doc, selectedColor, onCreateSticky, connectionState } = props;

  const handleColor = useCallback(
    (color: StickyColor) => {
      if (selection.selectedId) setStickyColor(doc, selection.selectedId, color);
    },
    [doc, selection.selectedId],
  );

  const handleDelete = useCallback(() => {
    if (selection.selectedId) {
      deleteObject(doc, selection.selectedId);
      selection.select(null);
    }
  }, [doc, selection]);

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <Toolbar onCreateSticky={onCreateSticky} />
      {selectedColor !== null && !selection.editingId && (
        <NoteToolbar color={selectedColor} onColor={handleColor} onDelete={handleDelete} />
      )}
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}

/** Installs the camera bridge; rendered inside BoardViewport so camera context is available. */
function CameraBridge(props: {
  register(bridge: BoardBridge | null): void;
}): null {
  const { camera } = useBoardCamera();
  const registerRef = useRef(props.register);
  registerRef.current = props.register;

  useEffect(() => {
    const el = document.querySelector('[data-testid="board"]') as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    const vw = rect?.width || window.innerWidth || 1024;
    const vh = rect?.height || window.innerHeight || 768;
    const bridge: BoardBridge = {
      toWorld: (p) => screenToWorld(camera, p),
      viewportCentreWorld: () => screenToWorld(camera, { x: vw / 2, y: vh / 2 }),
    };
    registerRef.current(bridge);
    return () => registerRef.current(null);
  }, [camera]);

  return null;
}

/** World-layer sticky notes. */
function BoardObjects(props: {
  notes: ReturnType<typeof useBoardDoc>['notes'];
  doc: ReturnType<typeof useBoardDoc>['doc'];
  selection: SelectionState;
}) {
  const { camera } = useBoardCamera();
  const { notes, doc, selection } = props;

  return (
    <>
      {[...notes]
        .slice()
        // Render in a stable DOM order (by id) so React does not reorder the
        // element during a drag — reordering can release pointer capture in
        // Chromium. Stacking is handled by the CSS z-index on each note.
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={note.id === selection.selectedId}
            editing={note.id === selection.editingId}
            onSelect={selection.select}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
          />
        ))}
    </>
  );
}

/** Extract board ID from /b/:boardId path. */
function getBoardIdFromPath(): string | undefined {
  const match = window.location.pathname.match(/^\/b\/([A-Za-z0-9_-]+)/);
  return match?.[1];
}

/**
 * Top-level layout: the infinite board fills the window, sticky notes live in
 * the world layer, toolbars and controls in the overlay.
 */
export function App(props: { doc?: Y.Doc } = {}) {
  const boardId = getBoardIdFromPath();
  const { doc, notes, connectionState } = useBoardDoc(props.doc, boardId);
  const selection = useSelection();
  const bridgeRef = useRef<BoardBridge | null>(null);
  const registerBridge = useCallback((b: BoardBridge | null) => {
    bridgeRef.current = b;
  }, []);

  // Watch for remote deletions that affect current selection/editing
  useEffect(() => {
    const objects = doc.getMap('objects');
    const checkDeletion = () => {
      if (selection.editingId && !objects.has(selection.editingId)) {
        selection.endEdit('unselected');
      }
      if (selection.selectedId && !objects.has(selection.selectedId)) {
        selection.select(null);
      }
    };
    const observer = () => checkDeletion();
    objects.observeDeep(observer);
    return () => objects.unobserveDeep(observer);
  }, [doc, selection]);

  // Keyboard handling: Enter -> start editing; Delete/Backspace -> delete note.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      if (e.key === 'Enter') {
        if (selection.selectedId && selection.editingId === null) {
          e.preventDefault();
          selection.startEdit(selection.selectedId);
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.editingId !== null) return;
        if (selection.selectedId) {
          e.preventDefault();
          deleteObject(doc, selection.selectedId);
          selection.select(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selection]);

  const handleBoardDblClick = useCallback(
    (point: Point) => {
      const b = bridgeRef.current;
      const world = b ? b.toWorld(point) : point;
      const id = createSticky(doc, world);
      selection.select(id);
      selection.startEdit(id);
    },
    [doc, selection],
  );

  const handleCreateSticky = useCallback(() => {
    const b = bridgeRef.current;
    const world = b ? b.viewportCentreWorld() : { x: 0, y: 0 };
    const id = createSticky(doc, world);
    selection.select(id);
    selection.startEdit(id);
  }, [doc, selection]);

  const handleEmptyClick = useCallback(() => {
    selection.select(null);
  }, [selection]);

  const selectedNote = notes.find((n) => n.id === selection.selectedId) ?? null;
  const selectedColor: StickyColor | null = selectedNote ? selectedNote.color : null;

  return (
    <BoardViewport
      children={
        <>
          <CameraBridge register={registerBridge} />
          <BoardObjects notes={notes} doc={doc} selection={selection} />
        </>
      }
      overlay={
        <BoardChrome
          selection={selection}
          doc={doc}
          selectedColor={selectedColor}
          onCreateSticky={handleCreateSticky}
          connectionState={connectionState}
        />
      }
      onBoardDblClick={handleBoardDblClick}
      onBoardEmptyClick={handleEmptyClick}
    />
  );
}
