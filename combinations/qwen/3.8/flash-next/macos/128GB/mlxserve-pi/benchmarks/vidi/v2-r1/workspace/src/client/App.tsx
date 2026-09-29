import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import type * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  type StickySnapshot,
} from '../shared/board-model';
import { DEFAULT_STICKY_COLOR } from '../shared/config';
import { BoardViewport } from './canvas/BoardViewport';
import { useBoardCamera } from './canvas/BoardViewport';
import {
  canZoomIn as canZoomInWith,
  canZoomOut as canZoomOutWith,
  screenToWorld,
  zoomPercent,
  type Camera,
  type Point,
} from './canvas/camera';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';

/**
 * The whole application at this story's scope: an infinite, pannable, zoomable
 * board (story 1) populated with sticky notes (this story). The camera is the
 * source of truth for the view; the notes live in the shared Y.Doc.
 */
export function App(): ReactNode {
  const { doc, notes } = useBoardDoc();
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  // The latest camera, so a double-click on empty space can be mapped to a
  // world position from the viewport callback (which lives outside the provider).
  const cameraRef = useRef<Camera | null>(null);

  const onCreated = useCallback(
    (id: string): void => {
      select(id);
      startEdit(id);
    },
    [select, startEdit],
  );

  const onEmptyDoubleClick = useCallback(
    (screen: Point): void => {
      const camera = cameraRef.current;
      if (!camera) return;
      const id = createSticky(doc, screenToWorld(camera, screen), DEFAULT_STICKY_COLOR);
      if (id) onCreated(id);
    },
    [doc, onCreated],
  );

  // A click on empty board space clears the selection. (When editing, the
  // editor already ended on the same pointerdown, so this is a no-op then.)
  const onEmptyClick = useCallback((): void => {
    select(null);
  }, [select]);

  // Global keyboard shortcuts, ignored while a note is being edited (the caret
  // owns the keyboard then) or while a form control / button is focused.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (editingId !== null) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'BUTTON' ||
          tag === 'SELECT' ||
          tag === 'A' ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (event.key === 'Enter') {
        if (selectedId !== null) {
          event.preventDefault();
          startEdit(selectedId);
        }
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedId !== null) {
          event.preventDefault();
          deleteObject(doc, selectedId);
          select(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, editingId, doc, startEdit, select]);

  return (
    <BoardViewport
      chrome={
        <BoardChrome
          doc={doc}
          cameraRef={cameraRef}
          onCreated={onCreated}
        />
      }
      onEmptyClick={onEmptyClick}
      onEmptyDoubleClick={onEmptyDoubleClick}
    >
      <BoardObjects
        doc={doc}
        notes={notes}
        selectedId={selectedId}
        editingId={editingId}
        select={select}
        startEdit={startEdit}
        endEdit={endEdit}
      />
    </BoardViewport>
  );
}

/** Screen-space chrome: left tool rail, zoom controls, navigation hint. */
function BoardChrome({
  doc,
  cameraRef,
  onCreated,
}: {
  doc: Y.Doc;
  cameraRef: { current: Camera | null };
  onCreated(id: string): void;
}): ReactNode {
  const { camera, hasNavigated, zoomStep, reset } = useBoardCamera();

  // Publish the latest camera so App-scope handlers can convert screen -> world.
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera, cameraRef]);

  const createStickyCentre = (): void => {
    const camera = cameraRef.current;
    if (!camera) return;
    const world = screenToWorld(camera, {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const id = createSticky(doc, world, DEFAULT_STICKY_COLOR);
    if (id) onCreated(id);
  };

  return (
    <>
      <Toolbar onCreateSticky={createStickyCentre} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomInWith(camera)}
        canZoomOut={canZoomOutWith(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}

/** The sticky notes, positioned in world space and interactive. */
function BoardObjects({
  doc,
  notes,
  selectedId,
  editingId,
  select,
  startEdit,
  endEdit,
}: {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}): ReactNode {
  const { camera } = useBoardCamera();
  return (
    <>
      {notes.map((note) => (
        <StickyNote
          key={note.id}
          note={note}
          doc={doc}
          zoom={camera.zoom}
          selected={note.id === selectedId}
          editing={note.id === editingId}
          onSelect={select}
          onStartEdit={startEdit}
          onEndEdit={endEdit}
        />
      ))}
    </>
  );
}
