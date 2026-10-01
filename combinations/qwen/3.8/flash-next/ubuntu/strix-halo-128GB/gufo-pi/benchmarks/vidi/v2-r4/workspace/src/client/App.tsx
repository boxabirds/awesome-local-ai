import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BoardViewport,
  type ViewportBridge,
} from './canvas/BoardViewport';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import * as Y from 'yjs';
import { createSticky, deleteObject } from '../shared/board-model';
import type { Camera, Point } from './canvas/camera';

/** True when the key press belongs to the focused field, not the board. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * The board: a navigable infinite canvas (story 1) populated with sticky notes
 * (story 2). Selection and editing are local; the notes live in the board
 * document.
 */
export interface AppProps {
  /**
   * Optional board document. Production passes nothing and the app owns one;
   * component tests pass a doc they can also read and mutate.
   */
  doc?: Y.Doc;
}

export function App({ doc: externalDoc }: AppProps = {}): React.JSX.Element {
  const { doc, notes } = useBoardDoc(externalDoc);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const bridgeRef = useRef<ViewportBridge | null>(null);
  // Notes are drawn inside the zoomed world layer; they need the zoom for the
  // drag delta and to counter-scale their toolbar.
  const [zoom, setZoom] = useState(1);
  const onCameraChange = useCallback((camera: Camera) => setZoom(camera.zoom), []);

  /** Centre a new note on a world point, select it and start typing. */
  const createAndEdit = useCallback(
    (world: Point) => {
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [doc, startEdit],
  );

  const onCreateStickyWorld = useCallback(
    (world: Point) => {
      createAndEdit(world);
    },
    [createAndEdit],
  );

  /** The toolbar button: a note centred in the visible board area. */
  const onCreateSticky = useCallback(() => {
    const centre = bridgeRef.current?.centreWorld();
    if (!centre) return;
    createAndEdit(centre);
  }, [createAndEdit]);

  const clearSelection = useCallback(() => select(null), [select]);

  const onDeleted = useCallback(
    (id: string) => {
      if (selectedId === id) select(null);
    },
    [selectedId, select],
  );

  // Board keyboard: Enter edits the selected note; Delete/Backspace removes it.
  // Both are ignored while a note is being edited or while a field has focus,
  // so the keys keep editing text instead of touching notes.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (editingId !== null) return;
      if (isTextEntry(event.target)) return;
      if (event.key === 'Enter') {
        if (!selectedId) return;
        event.preventDefault();
        startEdit(selectedId);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selectedId) return;
        event.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, editingId, selectedId, select, startEdit]);

  return (
    <div className="app">
      <BoardViewport
        bridgeRef={bridgeRef}
        onCreateStickyWorld={onCreateStickyWorld}
        onClearSelection={clearSelection}
        onCameraChange={onCameraChange}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={zoom}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
            onDeleted={onDeleted}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={onCreateSticky} />
    </div>
  );
}
