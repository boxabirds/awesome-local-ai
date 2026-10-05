/**
 * The board screen: the infinite canvas from story 1 with the sticky notes of
 * story 2 on top of it.
 *
 * This component is where the three pieces of state meet — the camera (per
 * visit), the document (the board's content) and the selection (per client) —
 * and where the board-wide keyboard shortcuts live. Everything that changes a
 * note goes through `src/shared/board-model.ts`.
 */

import { useCallback, useEffect, useRef, type JSX } from 'react';
import type * as Y from 'yjs';
import { createSticky, deleteObject, snapshot } from '../shared/board-model';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection, type SelectionControls } from './board/useSelection';
import { screenToWorld, canZoomIn, canZoomOut, zoomPercent, type Point } from './canvas/camera';
import { registerTestHooks } from './canvas/testHooks';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { CameraProvider, useCameraContext } from './canvas/useCamera';
import { StickyNote } from './objects/StickyNote';

export interface AppProps {
  /**
   * A board document to use instead of making one. Tests pass a private `Y.Doc`
   * so they can assert on what was stored; story 3 will pass the document that is
   * synced with a room.
   */
  doc?: Y.Doc;
}

export function App(props: AppProps = {}): JSX.Element {
  return (
    <CameraProvider>
      <Board doc={props.doc} />
    </CameraProvider>
  );
}

/** Is the caret somewhere the user is typing? Then the keys are theirs. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Is the key press addressed to a control rather than to the board? A button
 * handles Enter and Space itself, and Delete on a focused swatch must not delete
 * the note it belongs to.
 */
function isControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('button, a, select, [role="toolbar"]') !== null;
}

/**
 * The board: notes in world space, the tool palette on the left, the zoom
 * control in the corner and the first-use hint until the user moves.
 */
function Board(props: { doc?: Y.Doc }): JSX.Element {
  const { camera, viewport, hasNavigated, zoomStep, reset } = useCameraContext();
  const { doc, notes } = useBoardDoc(props.doc);
  const selection = useSelection();

  // Handlers registered once read the live selection through a ref.
  const selectionRef = useRef<SelectionControls>(selection);
  selectionRef.current = selection;

  /** Put a new note in the middle of a screen point and start typing it. */
  const createAt = useCallback(
    (screenPoint: Point, document: Y.Doc, startEdit: (id: string) => void) => {
      const id = createSticky(document, screenToWorld(camera, screenPoint));
      if (!id) return;
      startEdit(id);
    },
    [camera]
  );

  const createAtScreenCentre = useCallback(() => {
    createAt({ x: viewport.width / 2, y: viewport.height / 2 }, doc, selectionRef.current.startEdit);
  }, [createAt, doc, viewport.height, viewport.width]);

  // Test builds expose what the document holds, so e2e asserts on stored content
  // rather than guessing it from the screen.
  useEffect(() => registerTestHooks({ getBoard: () => snapshot(doc) }), [doc]);

  // A selection that refers to a note that is no longer on the board is dropped,
  // so nothing can act on a stale id.
  useEffect(() => {
    const { selectedId } = selectionRef.current;
    if (!selectedId) return;
    if (!notes.some((note) => note.id === selectedId)) selectionRef.current.select(null);
  }, [notes]);

  // Board-wide keys: Enter edits the selected note, Delete and Backspace remove
  // it. While a note is being typed into they are not ours at all.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (selectionRef.current.editingId) return;
      if (isTextEntry(event.target) || isControl(event.target)) return;

      const selectedId = selectionRef.current.selectedId;
      if (!selectedId) return; // nothing selected: the keys do nothing

      if (event.key === 'Enter') {
        event.preventDefault();
        selectionRef.current.startEdit(selectedId);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        // A note that vanished between events is just no longer there.
        if (deleteObject(doc, selectedId)) selectionRef.current.select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc]);

  const { select, startEdit, endEdit } = selection;

  return (
    <>
      <BoardViewport
        doc={doc}
        onStickyCreated={startEdit}
        onEmptyClick={() => select(null)}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.selectedId === note.id}
            editing={selection.editingId === note.id}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtScreenCentre} />
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
