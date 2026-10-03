import { useCallback, useEffect, useMemo } from 'react';
import type { JSX } from 'react';

import { Toolbar } from './board/Toolbar.js';
import { useBoardDoc } from './board/useBoardDoc.js';
import { useSelection } from './board/useSelection.js';
import { BoardViewport } from './canvas/BoardViewport.js';
import { screenToWorld, viewportCentre } from './canvas/camera.js';
import { NavigationHint } from './canvas/NavigationHint.js';
import { ZoomControls } from './canvas/ZoomControls.js';
import {
  CameraProvider,
  useCamera,
  useCameraContextValue,
  useViewportSize,
} from './canvas/useCamera.js';
import { StickyNote } from './objects/StickyNote.js';
import { createSticky, deleteObject } from '../shared/board-model.js';

/** Focus guard: a keyboard shortcut must not fire while the user is typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const name = target.tagName;
  return name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT' || target.isContentEditable;
}

/**
 * Top-level layout: the board fills the window, the toolbar stands on its left
 * edge, the zoom controls sit in the bottom-right corner and the first-use hint
 * at the bottom centre. The camera lives here (one camera per visit, per
 * device) and is shared with the board surface through context; the board
 * content lives in the `Y.Doc` that `useBoardDoc` owns.
 */
export function App(): JSX.Element {
  const viewport = useViewportSize();
  const api = useCamera(viewport);
  const context = useCameraContextValue(api, viewport);

  // The Y.Doc is the one place board content is kept: every note with its
  // position, colour, text and stacking order. Selection and editing are
  // deliberately *not* in it: what this user has selected is not board content,
  // and once the document is shared (story 3) writing it there would move other
  // people's selection.
  const { doc, notes } = useBoardDoc();
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  /** Create a note centred on a world point, select it and open it for typing. */
  const createAt = useCallback(
    (x: number, y: number) => {
      const id = createSticky(doc, { x, y });
      if (typeof id !== 'string') return;
      select(id);
      startEdit(id);
    },
    [doc, select, startEdit],
  );

  /** The Sticky note button and the `N` shortcut: the middle of what is visible. */
  const createInMiddleOfView = useCallback(() => {
    const centre = viewportCentre(viewport);
    const world = screenToWorld(api.camera, centre);
    createAt(world.x, world.y);
  }, [api.camera, createAt, viewport]);

  /**
   * The notes in a stable order, which is *not* the drawing order: they are drawn
   * by their `z` (a CSS stacking order), while the DOM keeps one element per note
   * in the order they were made. Reordering the elements every time a note is
   * brought to the front would move a node that has the pointer captured, which
   * ends the drag in the middle of a gesture - and it would throw away React's
   * state for a note the user is typing into.
   */
  const stackOrder = useMemo(
    () =>
      [...notes].sort(
        (a, b) =>
          a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      ),
    [notes],
  );

  // A note that is no longer in the document cannot stay selected or open for
  // editing: clicking the bin - or a delete that arrives from elsewhere - clears
  // the local state that pointed at it, and nothing is re-created.
  useEffect(() => {
    const alive = new Set(notes.map((note) => note.id));
    if (editingId !== null && !alive.has(editingId)) {
      endEdit('unselected');
    } else if (selectedId !== null && !alive.has(selectedId)) {
      select(null);
    }
  }, [notes, editingId, selectedId, endEdit, select]);

  // The keyboard shortcuts belong to the board, not to a focused element, so
  // this listener is on `window` rather than on the canvas.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Never swallow a keystroke that belongs to a text field.
      if (isTypingTarget(event.target)) return;

      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        createInMiddleOfView();
      } else if (event.key === 'Enter') {
        if (selectedId !== null && editingId === null) {
          event.preventDefault();
          startEdit(selectedId);
        }
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedId !== null && editingId === null) {
          event.preventDefault();
          deleteObject(doc, selectedId);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [api.camera, createInMiddleOfView, doc, editingId, select, selectedId, startEdit]);

  return (
    <div className="app" data-testid="app">
      <CameraProvider value={context}>
        <Toolbar onCreateSticky={createInMiddleOfView} />
        <BoardViewport
          doc={doc}
          onStickyCreated={(id) => {
            select(id);
            startEdit(id);
          }}
          onEmptyClick={() => {
            // Clicking empty board space selects nothing. While a note is being
            // edited its own editor ends the editing (and clears the selection),
            // so the note the user is typing into is never lost by a stray click.
            if (editingId === null) select(null);
          }}
        >
          {stackOrder.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={api.camera.zoom}
              selected={note.id === selectedId}
              editing={note.id === editingId}
              onSelect={select}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
            />
          ))}
        </BoardViewport>
      </CameraProvider>
      <ZoomControls
        zoomPercent={context.zoomPercent}
        canZoomIn={context.canZoomIn}
        canZoomOut={context.canZoomOut}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />
    </div>
  );
}
