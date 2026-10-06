/**
 * The board: everything a person does to a board, and nothing about which board.
 *
 * This used to be `App.tsx`, which knew both — the board, and the address that named it. Story 5
 * put the address side somewhere else (`src/client/router.ts`, `src/client/pages/`), because the
 * page that shows a board now has to be able to say "that link is not a board" and "we cannot
 * reach vidi6" before a board is on screen at all, and a board that takes those answers on
 * itself would be three pages in one file. What is left here is the same board stories 1 to 4
 * drew, taking a `boardId` it is told and connecting to it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';

import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  zoomPercent,
  type Point,
  type Size,
} from '../canvas/camera';
import { useCamera } from '../canvas/useCamera';
import { registerTestHooks } from '../canvas/testHooks';
import { useBoardDoc } from './useBoardDoc';
import { useBoardConnection } from './useBoardConnection';
import { ConnectionStatus } from './ConnectionStatus';
import { canEdit, type BoardStatus, type ConnectBoardOptions } from './connection';
import { useSelection, type Selection } from './useSelection';
import { Toolbar } from './Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { isTypingTarget } from '../objects/StickyTextEditor';
import { deleteObject, createSticky, type StickySnapshot } from '../../shared/board-model';

/** The board fills the window; its size is the camera's viewport. */
const measureWindow = (): Size =>
  typeof window === 'undefined'
    ? { width: 0, height: 0 }
    : { width: window.innerWidth, height: window.innerHeight };

/** Test handle: the pieces a component test needs to drive and inspect. */
export interface BoardHandle {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  selection: Selection;
}

export interface BoardProps {
  /** Overrides the measured window size (component tests pass a fixed size). */
  viewport?: Size;
  /** Filled in on every render; only used by tests. */
  handle?: { current: BoardHandle | null };
  /**
   * The board to sync with, from `/b/<board id>` in the address (story 3). Left out, the
   * board is a board of one: no room, no badge, nothing to reconnect from — which is what
   * the component tests drive straight into the document. Given by `BoardPage`, which has
   * already established that the board exists; this component never decides that for itself.
   */
  boardId?: string;
  /**
   * How to connect. Normally nobody passes this: the board dials the room for `boardId`. A
   * component test passes a provider of its own, which is the only way to have a room that
   * closes the connection with a particular code on a particular millisecond.
   */
  connect?: ConnectBoardOptions;
}

/**
 * The whole board: the infinite viewport from story 1, the left toolbar, the
 * sticky notes, the zoom control and the first-use hint, all sharing one camera,
 * one `Y.Doc` and one local selection.
 *
 * Keyboard shortcuts live here, on `window`: Enter starts editing the selected
 * note, Delete/Backspace deletes it — and both are ignored while a note is being
 * edited or focus is in a field, so those keys edit text instead.
 */
export function Board({
  viewport: viewportProp,
  handle,
  boardId,
  connect,
}: BoardProps = {}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<Size>(measureWindow);
  const viewport = viewportProp ?? measured;
  const controller = useCamera(viewport);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  const { doc, notes } = useBoardDoc();
  const selection = useSelection();
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  if (handle) handle.current = { doc, notes, selection };

  // The live connection to the room this board lives in (story 3). Created once per
  // board id, and only when there is a board id to connect to.
  const { status, connection } = useBoardConnection(doc, boardId, connect);
  const statusRef = useRef<BoardStatus>(status);
  statusRef.current = status;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const boardIdRef = useRef<string | null>(boardId ?? null);
  boardIdRef.current = boardId ?? null;

  // A note that somebody else deleted cannot stay selected, cannot stay open for
  // editing and cannot still be being dragged: it is gone from the board, so the
  // selection that pointed at it is dropped. Drag state lives in the note itself, which
  // unmounts with the note, and that ends the drag.
  useEffect(() => {
    const current = selectionRef.current;
    const gone = (id: string | null): boolean =>
      id !== null && !notes.some((note) => note.id === id);
    if (gone(current.selectedId) || gone(current.editingId)) current.select(null);
  }, [notes]);

  // Viewport size from a ResizeObserver. A resize changes only the size: the
  // camera's x/y (world point at the top-left) stays put.
  useEffect(() => {
    if (viewportProp) return; // fixed size from the caller
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setMeasured((previous) =>
        previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewportProp]);

  const { camera } = controller;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  /**
   * Whether this board may be written to. One connection state says no: the room answered
   * "I could not read this board", and a change made to a copy of a board that could not be
   * read is not a change anybody is going to see. A dropped line says yes — see `canEdit`.
   */
  const editable = canEdit(status);
  const editableRef = useRef(editable);
  editableRef.current = editable;

  /**
   * The one way a note is opened for editing: from the toolbar-centred create, from a
   * double-click on the note, from Enter. Going through here means a board that cannot be
   * written to has one door to shut rather than four.
   */
  const startEdit = useCallback((id: string) => {
    if (!editableRef.current) return;
    selectionRef.current.startEdit(id);
  }, []);

  // A board that stops being writable stops being writable *now*, not when the note happens
  // to close: an editor left open on a board the room cannot read invites text that has
  // nowhere to go. The note stays selected, which is where the person left it.
  useEffect(() => {
    if (editable) return;
    const current = selectionRef.current;
    if (current.editingId !== null) current.endEdit('selected');
  }, [editable]);

  /** Creates a note centred on a world point and starts typing in it right away.
   * Used for the toolbar button (screen centre converted once in App) and for a
   * double-click on empty board space (the viewport converts). */
  const createAt = useCallback(
    (world: Point) => {
      if (!editableRef.current) return;
      const id = createSticky(doc, world);
      if (typeof id !== 'string') return;
      startEdit(id);
    },
    [doc, startEdit],
  );

  /** Toolbar button: a note centred in the middle of the visible board area. */
  const createInCentre = useCallback(() => {
    const size = viewportRef.current;
    createAt(screenToWorld(cameraRef.current, { x: size.width / 2, y: size.height / 2 }));
  }, [createAt]);

  /** The bin button deleted a note: drop the selection that pointed at it. */
  const noteDeleted = useCallback((id: string) => {
    const current = selectionRef.current;
    if (current.selectedId === id || current.editingId === id) current.select(null);
  }, []);

  // Test-only hook (excluded from production builds by the mode check).
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    return registerTestHooks({
      setCamera: (patch) => controllerRef.current.setCamera(patch),
      getCamera: () => controllerRef.current.camera,
      get connectionState() {
        return statusRef.current;
      },
      get connectionStates() {
        return connectionRef.current?.statesSeen() ?? [statusRef.current];
      },
      get boardId() {
        return boardIdRef.current;
      },
    });
  }, []);

  // Enter edits the note; Delete/Backspace deletes it. The note is the selected
  // one, or — for keyboard-only use — the one that has focus. While a note is
  // being edited (or focus is in a field) the keys are left alone, so they edit
  // characters instead of the note.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;
      if (selectionRef.current.editingId !== null) return;
      const id = selectionRef.current.selectedId ?? focusedNoteId(event.target);
      if (!id) return;
      if (event.key === 'Enter') {
        if (!editableRef.current) return;
        event.preventDefault();
        startEdit(id);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        // A key that does nothing should not swallow the browser's own meaning of it, so
        // the gate comes before `preventDefault`.
        if (!editableRef.current) return;
        event.preventDefault();
        deleteObject(doc, id);
        selectionRef.current.select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, startEdit]);

  return (
    <div className="vidi6-app" data-testid="app" ref={containerRef}>
      <BoardViewport
        controller={controller}
        onCreateSticky={createAt}
        onClearSelection={() => selection.select(null)}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            doc={doc}
            editing={selection.editingId === note.id}
            note={note}
            selected={selection.selectedId === note.id}
            zoom={camera.zoom}
            editable={editable}
            onDeleted={noteDeleted}
            onEndEdit={selection.endEdit}
            onSelect={selection.select}
            onStartEdit={startEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createInCentre} canCreate={editable} />
      <ZoomControls
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onReset={controller.reset}
        onZoomIn={() => controller.zoomStep('in')}
        onZoomOut={() => controller.zoomStep('out')}
        zoomPercent={zoomPercent(camera)}
      />
      <NavigationHint visible={!controller.hasNavigated} />
      <ConnectionStatus state={status} />
    </div>
  );
}

/**
 * The id of the note that has focus, or null. Only the note element itself counts:
 * a focused swatch or bin button must keep the browser's own Enter/Delete meaning.
 */
function focusedNoteId(target: EventTarget | null): string | null {
  return target instanceof HTMLElement ? (target.dataset['noteId'] ?? null) : null;
}
