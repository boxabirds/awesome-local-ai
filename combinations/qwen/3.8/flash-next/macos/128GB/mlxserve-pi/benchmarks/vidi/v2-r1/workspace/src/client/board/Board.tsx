import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { createSticky, deleteObject, type StickySnapshot } from '../../shared/board-model';
import { DEFAULT_STICKY_COLOR } from '../../shared/config';
import { BoardViewport } from '../canvas/BoardViewport';
import { useBoardCamera } from '../canvas/BoardViewport';
import {
  canZoomIn as canZoomInWith,
  canZoomOut as canZoomOutWith,
  screenToWorld,
  zoomPercent,
  type Camera,
  type Point,
} from '../canvas/camera';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { Toolbar } from './Toolbar';
import { reportConnectionState } from '../canvas/testHooks';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { StickyNote } from '../objects/StickyNote';
import { SharePanel } from '../share/SharePanel';

/**
 * The board itself: an infinite, pannable, zoomable canvas (story 1) populated
 * with sticky notes (story 2), live-connected to a room (story 3) and saved
 * (story 4). This is the stories 1–4 UI, unchanged by story 5 except that it is
 * now reached only through `BoardPage` once the board is known to exist, and it
 * carries the Share panel. The camera and the selection belong to this screen;
 * only the notes are shared.
 *
 * A board is given, never invented here: which board this is, and whether it
 * exists, is decided above this component (share.not_found).
 */
export function Board({ boardId }: { boardId: string }): ReactNode {
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  // A board the room could not read is shown and not edited: the notes on the
  // screen are whatever the last successful read found, and writing into a board
  // we cannot see the whole of is how a board gets lost (PRD persist.corrupt_snapshot).
  const canEdit = connectionState !== 'load_failed';
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
      if (!canEdit) return;
      const camera = cameraRef.current;
      if (!camera) return;
      const id = createSticky(doc, screenToWorld(camera, screen), DEFAULT_STICKY_COLOR);
      if (id) onCreated(id);
    },
    [canEdit, doc, onCreated],
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
      if (!canEdit) return;
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
  }, [canEdit, selectedId, editingId, doc, startEdit, select]);

  // A board that goes out of reach while a note is open on the screen closes it:
  // the editor would otherwise keep taking typing into a document nothing saves.
  useEffect(() => {
    if (!canEdit) select(null);
  }, [canEdit, select]);

  // So the e2e suite can read the connection state as well as the badge.
  useEffect(() => {
    reportConnectionState(connectionState);
  }, [connectionState]);

  return (
    <BoardViewport
      chrome={
        <BoardChrome
          doc={doc}
          boardId={boardId}
          cameraRef={cameraRef}
          onCreated={onCreated}
          connectionState={connectionState}
          canEdit={canEdit}
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
        canEdit={canEdit}
        select={select}
        startEdit={startEdit}
        endEdit={endEdit}
      />
    </BoardViewport>
  );
}

/** Screen-space chrome: left tool rail, share panel, zoom controls, hint. */
function BoardChrome({
  doc,
  boardId,
  cameraRef,
  onCreated,
  connectionState,
  canEdit,
}: {
  doc: Y.Doc;
  boardId: string;
  cameraRef: { current: Camera | null };
  onCreated(id: string): void;
  connectionState: ConnectionState;
  canEdit: boolean;
}): ReactNode {
  const { camera, hasNavigated, zoomStep, reset } = useBoardCamera();

  // Publish the latest camera so board-scope handlers can convert screen -> world.
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera, cameraRef]);

  const createStickyCentre = (): void => {
    if (!canEdit) return;
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
      <Toolbar onCreateSticky={createStickyCentre} disabled={!canEdit} />
      <SharePanel boardId={boardId} />
      <ConnectionStatus state={connectionState} />
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
  canEdit,
  select,
  startEdit,
  endEdit,
}: {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  selectedId: string | null;
  editingId: string | null;
  canEdit: boolean;
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
          editable={canEdit}
          onSelect={select}
          onStartEdit={startEdit}
          onEndEdit={endEdit}
        />
      ))}
    </>
  );
}
