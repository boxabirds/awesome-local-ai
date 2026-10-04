/**
 * The board itself: viewport, notes, toolbar, zoom controls and the connection
 * badge, showing the one board `boardId` names.
 *
 * This is the whole of what story 1..4 put in `App.tsx`. Story 5 moved it here
 * unchanged and put a page around it (`pages/BoardPage.tsx`) whose only new job is
 * to find out whether that board exists before showing this — so nothing about
 * navigating, note editing or syncing is different because a board now has to have
 * been created to be seen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Point,
} from '../canvas/camera';
import { CameraContext, useCamera, useViewportSize } from '../canvas/useCamera';
import { registerTestHooks } from '../canvas/testHooks';
import { Toolbar } from './Toolbar';
import { useBoardDoc } from './useBoardDoc';
import { useForgetMissingNotes, useSelection } from './useSelection';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { StickyNote } from '../objects/StickyNote';
import { NoteToolbar } from '../objects/NoteToolbar';
import {
  createSticky,
  deleteObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import type { StickyColor } from '../../shared/config';

/** Screen offset between a note's top-left and its floating toolbar. */
const NOTE_TOOLBAR_GAP = 8;

/**
 * Whether this page may change the board right now.
 *
 * Everything the user does here is a local change to a document that syncs later, so
 * almost every state leaves the board editable: a dropped connection keeps the edits,
 * and they go out when it returns. One state is different. When the room says it
 * could not load the board, the document in front of the person is not a copy of
 * anything — an edit made now is a change to a board that does not exist, by them
 * alone. So creating, dragging, typing, recolouring and deleting stop while it says
 * so, and start again on their own the moment the board arrives.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export function BoardSurface({ boardId }: { boardId: string }) {
  const viewport = useViewportSize();
  const board = useCamera(viewport);
  const { camera } = board;
  const { doc, notes, connection } = useBoardDoc(boardId);
  const selection = useSelection();

  // The one thing the connection state changes about the board itself.
  const editable = canEdit(connection);

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
      if (!canEdit(connection)) return; // a note added to a board that never arrived
      const id = createSticky(doc, world);
      if (id) selection.startEdit(id);
    },
    [doc, selection, connection],
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
  // The key handler is attached once, so it reads this rather than a stale render.
  const editableRef = useRef(editable);
  editableRef.current = editable;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // While typing in the note (or any field) the keys edit text.
      if (isEditableTarget(event.target) || editingIdRef.current) return;
      const id = selectedIdRef.current;
      if (!id) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        if (editableRef.current) startEditRef.current(id);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (!editableRef.current) return;
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
              editable={editable}
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
              onColor={(color: StickyColor) => {
                if (!editable) return;
                setStickyColor(doc, selectedNote.id, color);
              }}
              onDelete={() => {
                if (!editable) return;
                deleteObject(doc, selectedNote.id);
                selection.select(null);
              }}
            />
          </div>
        )}

        <Toolbar onCreateSticky={createAtCentre} createDisabled={!editable} />
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
