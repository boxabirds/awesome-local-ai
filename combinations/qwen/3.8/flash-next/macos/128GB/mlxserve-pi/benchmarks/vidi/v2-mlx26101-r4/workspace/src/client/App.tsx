import { useCallback, useEffect, useRef } from 'react';
import type { JSX } from 'react';

import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { Toolbar } from './components/Toolbar';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import type { Point } from './canvas/camera';
import { useCamera, useViewportSize } from './canvas/useCamera';
import { createSticky, deleteObject, NO_ID } from '../shared/board-model';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';

/** Keys that delete a selected note, and nothing else. */
const DELETE_KEYS = ['Delete', 'Backspace'];

/**
 * Top-level layout: the infinite board fills the window, the board toolbar is a
 * strip on the left, the zoom control floats bottom-right and the first-use hint
 * near the bottom centre.
 *
 * The board document, the selection and the keyboard shortcuts meet here, and
 * nowhere else: `useBoardDoc` owns the document and republishes it as notes,
 * `useSelection` holds what this window has selected (local, never shared), and
 * this component decides which key does what to which note.
 */
export function App(): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(rootRef);
  const { camera, hasNavigated, zoomStep, reset } = useCamera(viewport);
  const { doc, notes } = useBoardDoc();
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  /**
   * The notes in the order they should end up on screen. The document lists them by
   * stacking number; they are put in the page in the order they were made and stacked
   * with `zIndex` (see StickyNote), because moving the element a pointer is holding -
   * which is what re-sorting the list would do every time a note is raised - makes the
   * browser let go of the pointer and the drag stops halfway. Creation order is in the
   * document too, so every client still agrees on which of two equally raised notes
   * is on top.
   */
  const painted = [...notes].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  /**
   * A note is only selected while it exists. Deleting it — from the bin, with the
   * keyboard, or from whoever joins the board later — lets the selection, and any
   * editing inside it, go with it instead of pointing at nothing.
   */
  const selected = notes.some((note) => note.id === selectedId) ? selectedId : null;
  const editing = notes.some((note) => note.id === editingId) ? editingId : null;

  useEffect(() => {
    if (selectedId !== null && selected === null) select(null);
    if (editingId !== null && editing === null) select(null);
  }, [selectedId, editingId, selected, editing, select]);


  /** Put a note down centred on a world point and start typing straight away. */
  const createStickyAt = useCallback(
    (world: Point): void => {
      // `createSticky` centres the note on the point it is given, so the click
      // point becomes the middle of the note, not its top-left corner.
      const id = createSticky(doc, world);
      // A note that could not be created leaves no selection behind it.
      if (id !== NO_ID) startEdit(id);
    },
    [doc, startEdit],
  );

  /** The toolbar button adds a note in the middle of what is on screen. */
  const createStickyInCentre = useCallback((): void => {
    createStickyAt(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [camera, createStickyAt, viewport.height, viewport.width]);

  // Keyboard shortcuts, on the window so they work wherever the focus is — with
  // two exceptions: while typing in a note, and while a text field has the focus,
  // the keys belong to the text and must reach it untouched.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || isTextField(target))) return;
      // Escape is the note's own business: it keeps the text and stops editing.
      if (editing !== null) return;
      // A shortcut with a modifier held is the browser's or the operating
      // system's, not ours (Cmd+Backspace, Ctrl+Backspace, Alt+Backspace).
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'Enter') {
        if (selected === null) return; // nothing selected: this key does nothing
        event.preventDefault();
        startEdit(selected);
        return;
      }
      if (!DELETE_KEYS.includes(event.key)) return;
      if (selected === null) return;
      // Stop the browser going back a page on Backspace.
      event.preventDefault();
      deleteObject(doc, selected);
      select(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, editing, select, selected, startEdit]);

  return (
    <div className="board-app" data-testid="board-root" ref={rootRef}>
      <Toolbar onCreateSticky={createStickyInCentre} />
      <BoardViewport onCreateAt={createStickyAt} onClearSelection={() => select(null)}>
        {painted.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={note.id === selected}
            editing={note.id === editing}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => {
          zoomStep('in');
        }}
        onZoomOut={() => {
          zoomStep('out');
        }}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}

/** Keys typed here are text, not board commands. */
function isTextField(element: HTMLElement): boolean {
  const name = element.nodeName;
  return name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT';
}
