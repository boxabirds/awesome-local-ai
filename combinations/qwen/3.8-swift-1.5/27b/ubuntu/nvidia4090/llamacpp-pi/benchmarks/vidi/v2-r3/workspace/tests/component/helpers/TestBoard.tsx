import { useState, useEffect, useCallback } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../../../src/client/canvas/BoardViewport';
import { screenToWorld, worldToScreen } from '../../../src/client/canvas/camera';
import type { Camera, Point, Size } from '../../../src/client/canvas/camera';
import { useBoardDoc } from '../../../src/client/board/useBoardDoc';
import { useSelection } from '../../../src/client/board/useSelection';
import { Toolbar } from '../../../src/client/board/Toolbar';
import { StickyNote } from '../../../src/client/objects/StickyNote';
import { NoteToolbar } from '../../../src/client/objects/NoteToolbar';
import { createSticky, deleteObject, setStickyColor } from '../../../src/shared/board-model';
import { STICKY_SIZE_WORLD, type StickyColor } from '../../../src/shared/config';

export interface TestBoardProps {
  camera: Camera;
  viewportSize: Size;
  /** Called with the board doc once available (so tests can create/assert notes). */
  onDocReady?: (doc: Y.Doc) => void;
  beginPan?: (p: Point) => void;
  panMove?: (p: Point) => void;
  endPan?: () => void;
  wheel?: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
}

/**
 * A test harness that mirrors App: real Y.Doc, selection, notes, toolbars and
 * the Enter/Delete keyboard handlers — but with a fixed camera and viewport so
 * tests are deterministic.
 */
export function TestBoard({
  camera,
  viewportSize,
  onDocReady,
  beginPan,
  panMove,
  endPan,
  wheel,
}: TestBoardProps): React.ReactElement {
  const { doc, notes } = useBoardDoc();
  const sel = useSelection();
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    onDocReady?.(doc);
  }, [doc, onDocReady]);

  const createAtScreen = useCallback(
    (p: Point) => {
      const w = screenToWorld(camera, p);
      const id = createSticky(doc, w);
      if (id) sel.startEdit(id);
    },
    [camera, doc, sel],
  );

  const createAtCenter = useCallback(() => {
    createAtScreen({ x: viewportSize.width / 2, y: viewportSize.height / 2 });
  }, [createAtScreen, viewportSize.width, viewportSize.height]);

  const handleDelete = useCallback(() => {
    if (sel.selectedId) {
      deleteObject(doc, sel.selectedId);
      sel.select(null);
    }
  }, [doc, sel]);

  const handleColor = useCallback(
    (c: StickyColor) => {
      if (sel.selectedId) setStickyColor(doc, sel.selectedId, c);
    },
    [doc, sel],
  );

  const selectedId = sel.selectedId;
  const editingId = sel.editingId;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable);
      if (inField) return;
      if (e.key === 'Enter') {
        if (selectedId && editingId === null) {
          e.preventDefault();
          sel.startEdit(selectedId);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId && editingId === null) {
          e.preventDefault();
          handleDelete();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, editingId, sel, handleDelete]);

  // Stable render order (by id) so z-changes only affect z-index, never DOM order.
  const orderedNotes = [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const selectedNote = notes.find((n) => n.id === selectedId);
  const showToolbar = !!selectedNote && editingId === null && draggingId === null;
  let pos: { left: number; top: number } | null = null;
  if (selectedNote && showToolbar) {
    const tl = worldToScreen(camera, { x: selectedNote.x, y: selectedNote.y });
    pos = { left: tl.x + (STICKY_SIZE_WORLD * camera.zoom) / 2, top: tl.y - 8 };
  }

  return (
    <div>
      <BoardViewport
        camera={camera}
        beginPan={beginPan ?? (() => {})}
        panMove={panMove ?? (() => {})}
        endPan={endPan ?? (() => {})}
        wheel={wheel ?? (() => {})}
        onCreateStickyAt={createAtScreen}
        onClearSelection={() => sel.select(null)}
      >
        {orderedNotes.map((n) => (
          <StickyNote
            key={n.id}
            note={n}
            doc={doc}
            zoom={camera.zoom}
            selected={n.id === selectedId}
            editing={n.id === editingId}
            onSelect={sel.select}
            onStartEdit={sel.startEdit}
            onEndEdit={sel.endEdit}
            onDragStateChange={(d) => setDraggingId(d ? n.id : null)}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtCenter} />
      {showToolbar && selectedNote && pos && (
        <div
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <NoteToolbar color={selectedNote.color} onColor={handleColor} onDelete={handleDelete} />
        </div>
      )}
    </div>
  );
}
