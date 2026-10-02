/**
 * Top-level layout: the full-window board plus its fixed overlays.
 *
 * `CameraProvider` owns the camera (`useCamera`); `BoardLayout` reads it and
 * wires it to the viewport, the zoom controls and the navigation hint, and adds
 * the collaborative layer: the shared document (`useBoardDoc`), the local
 * selection (`useSelection`) and the sticky notes drawn from the snapshot.
 *
 * Two things are deliberately not in React state and not in the document:
 * selection/editing (local only, see `useSelection`) and the camera (story 1).
 */
import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';

import { createSticky, deleteObject } from '../shared/board-model';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { BoardViewport } from './canvas/BoardViewport';
import { CameraProvider, useCameraContext } from './canvas/CameraContext';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  zoomPercent,
  type Point,
} from './canvas/camera';
import { useWindowSize } from './canvas/useCamera';
import { StickyNote } from './objects/StickyNote';

/**
 * Whether the focused thing takes the key for itself: a field you type into,
 * or a control that acts on Enter. Pressing Enter on the delete bin has to press
 * the bin, not start editing the note behind it.
 */
function takesItsOwnKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  ) {
    return true;
  }
  return target.tagName === 'BUTTON' || target.tagName === 'A';
}

export interface AppProps {
  /** Bring your own document; the default is a fresh one (tests pass one). */
  doc?: Y.Doc;
}

function BoardLayout({ doc }: AppProps) {
  const nav = useCameraContext();
  const { camera } = nav;
  const viewport = useWindowSize();
  const board = useBoardDoc(doc);
  const selection = useSelection();
  const { notes } = board;

  // Latest values for listeners that are attached once.
  const latestRef = useRef({ camera, selection, doc: board.doc });
  latestRef.current = { camera, selection, doc: board.doc };

  // A note that disappears stops being selected or edited, so the toolbars and
  // the keyboard never point at a note that is not there.
  useEffect(() => {
    const { selectedId } = selection;
    if (selectedId === null) return;
    if (!notes.some((note) => note.id === selectedId)) selection.select(null);
  }, [notes, selection]);

  // Enter edits the selected note; Delete/Backspace removes it. While a note is
  // being edited these keys belong to the textarea, so nothing happens here.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (takesItsOwnKeys(event.target)) return;
      const { selection: sel, doc: document } = latestRef.current;
      if (sel.editingId !== null) return;
      const id = sel.selectedId;
      if (id === null) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObject(document, id);
        sel.select(null);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        sel.startEdit(id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /** Put a note on the board centred on a world point and start typing it. */
  const createAt = useCallback(
    (point: Point) => {
      const id = createSticky(latestRef.current.doc, point);
      if (!id) return;
      selection.startEdit(id);
    },
    [selection],
  );

  const createAtCentre = useCallback(() => {
    createAt(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [camera, createAt, viewport.height, viewport.width]);

  return (
    <div className="app">
      <Toolbar onCreateSticky={createAtCentre} />
      <BoardViewport
        onEmptyDoubleClick={(point) => {
          createAt(screenToWorld(camera, point));
        }}
        onEmptyClick={() => {
          selection.select(null);
        }}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={board.doc}
            zoom={camera.zoom}
            selected={selection.selectedId === note.id}
            editing={selection.editingId === note.id}
            onSelect={selection.select}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
          />
        ))}
      </BoardViewport>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => {
          nav.zoomStep('in');
        }}
        onZoomOut={() => {
          nav.zoomStep('out');
        }}
        onReset={nav.reset}
      />
      <NavigationHint visible={!nav.hasNavigated} />
    </div>
  );
}

export function App({ doc }: AppProps = {}) {
  return (
    <CameraProvider>
      <BoardLayout doc={doc} />
    </CameraProvider>
  );
}
