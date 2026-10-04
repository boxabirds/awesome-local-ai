import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Point,
} from './canvas/camera';
import { CameraContext, useCamera, useViewportSize } from './canvas/useCamera';
import { registerTestHooks } from './canvas/testHooks';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useForgetMissingNotes, useSelection } from './board/useSelection';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { StickyNote } from './objects/StickyNote';
import { NoteToolbar } from './objects/NoteToolbar';
import {
  createSticky,
  deleteObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../shared/board-model';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import type { StickyColor } from '../shared/config';

/** Screen offset between a note's top-left and its floating toolbar. */
const NOTE_TOOLBAR_GAP = 8;

/**
 * The whole routing of this app: `/b/<board id>` shows one board, and any other
 * address gets a brand-new board of its own (temporary — story 5 replaces the
 * client-side id with a board created by the server).
 */
export default function App() {
  const boardId = boardIdFromPath(window.location.pathname);

  useEffect(() => {
    if (boardId === null) window.location.replace(`/b/${newBoardId()}`);
  }, [boardId]);

  if (boardId === null) return null; // redirecting; nothing to show yet

  // `key` keeps two boards from ever sharing a document: opening another board
  // tears this one down completely instead of re-pointing it.
  return <Board key={boardId} boardId={boardId} />;
}

function Board({ boardId }: { boardId: string }) {
  const viewport = useViewportSize();
  const board = useCamera(viewport);
  const { camera } = board;
  const { doc, notes, connection } = useBoardDoc(boardId);
  const selection = useSelection();

  // A note somebody else deleted stops being selected, edited or dragged here.
  useForgetMissingNotes(selection, notes);

  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Expose the live document to tests (no-op in production builds).
  useEffect(() => {
    registerTestHooks({ doc, getNotes: () => snapshot(doc) as StickySnapshot[] });
  }, [doc]);

  // Create a note centred on a world point, then select + edit it.
  const createAtWorld = useCallback(
    (world: Point) => {
      const id = createSticky(doc, world);
      if (id) selection.startEdit(id);
    },
    [doc, selection],
  );

  // The Sticky note button creates a note at the centre of the visible area.
  const createAtCentre = useCallback(() => {
    const centre = screenCentre(camera, viewport);
    createAtWorld(centre);
  }, [camera, viewport, createAtWorld]);

  // Keyboard: Enter edits the selected note; Delete/Backspace removes it.
  const selectedIdRef = useRef(selection.selectedId);
  const editingIdRef = useRef(selection.editingId);
  selectedIdRef.current = selection.selectedId;
  editingIdRef.current = selection.editingId;
  const startEditRef = useRef(selection.startEdit);
  const selectRef = useRef(selection.select);
  startEditRef.current = selection.startEdit;
  selectRef.current = selection.select;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // While typing in the note (or any field) the keys edit text.
      if (isEditableTarget(event.target) || editingIdRef.current) return;
      const id = selectedIdRef.current;
      if (!id) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        startEditRef.current(id);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObject(doc, id);
        selectRef.current(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc]);

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selection.selectedId) ?? null,
    [notes, selection.selectedId],
  );

  // Render in a stable order (by id) so bringing a note to front — which
  // changes its z — never reorders the DOM and remounts a note mid-drag.
  // Stacking comes from each note's CSS z-index instead.
  const renderNotes = useMemo(() => [...notes].sort(byId), [notes]);

  const showNoteToolbar =
    selectedNote !== null && selection.editingId !== selectedNote.id && draggingId !== selectedNote.id;

  const noteToolbarPos = selectedNote
    ? worldToScreen(camera, { x: selectedNote.x, y: selectedNote.y })
    : { x: 0, y: 0 };

  return (
    <CameraContext.Provider value={board}>
      <div className="vidi6-app">
        <BoardViewport
          onCreateStickyAt={createAtWorld}
          onClearSelection={() => selection.select(null)}
        >
          {renderNotes.map((note) => (
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
              onDraggingChange={(dragging) => setDraggingId(dragging ? note.id : null)}
            />
          ))}
        </BoardViewport>

        {showNoteToolbar && selectedNote && (
          <div
            className="note-toolbar-anchor"
            style={{
              left: noteToolbarPos.x,
              top: noteToolbarPos.y - NOTE_TOOLBAR_GAP,
            }}
          >
            <NoteToolbar
              color={selectedNote.color}
              onColor={(color: StickyColor) => setStickyColor(doc, selectedNote.id, color)}
              onDelete={() => {
                deleteObject(doc, selectedNote.id);
                selection.select(null);
              }}
            />
          </div>
        )}

        <Toolbar onCreateSticky={createAtCentre} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => board.zoomStep('in')}
          onZoomOut={() => board.zoomStep('out')}
          onReset={board.reset}
        />
        <NavigationHint visible={!board.hasNavigated} />
        <ConnectionStatus state={connection} />
      </div>
    </CameraContext.Provider>
  );
}

/** The board id in `/b/<board id>`, or null when the address names no board. */
function boardIdFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  if (segments.length !== 2 || segments[0] !== 'b') return null;
  const candidate = decode(segments[1] ?? '');
  return isValidBoardId(candidate) ? candidate : null;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function screenCentre(
  camera: { x: number; y: number; zoom: number },
  viewport: { width: number; height: number },
): Point {
  // The world point at the centre of the visible board area.
  return screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 });
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}
