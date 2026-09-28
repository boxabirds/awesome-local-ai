import { type JSX, useState, useEffect, useCallback } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { canZoomIn, canZoomOut, zoomPercent, worldToScreen, screenToWorld } from './canvas/camera';
import { useCamera } from './canvas/useCamera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { NoteToolbar } from './objects/NoteToolbar';
import {
  createSticky,
  setStickyColor,
  deleteObject,
} from 'src/shared/board-model';
import { STICKY_SIZE_WORLD } from 'src/shared/config';

function focusIsInTextControl(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable
  );
}

export function App(): JSX.Element {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const cam = useCamera(size);
  const { doc, notes } = useBoardDoc();
  const sel = useSelection();
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Test hook: story 1 exposes setCamera; story 2 additionally exposes the
  // board doc so tests can drive the model directly (e.g. TC-37).
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      (window as unknown as Record<string, unknown>).__vidi6 = {
        setCamera: cam.setCamera,
        doc,
      };
    }
  }, [cam.setCamera, doc]);

  // Double-click on empty board space: create a note centred on the point,
  // select it and start editing (sticky.create_dblclick).
  const handleCreateStickyAt = useCallback(
    (world: { x: number; y: number }) => {
      const id = createSticky(doc, world);
      if (id) sel.startEdit(id);
    },
    [doc, sel],
  );

  // Toolbar button: create a note at the centre of the visible board area
  // (sticky.create_button) — works no matter where the board is panned.
  const handleCreateStickyCentred = useCallback(() => {
    const centre = screenToWorld(cam.camera, {
      x: size.width / 2,
      y: size.height / 2,
    });
    const id = createSticky(doc, centre);
    if (id) sel.startEdit(id);
  }, [cam.camera, size, doc, sel]);

  // Keyboard: Enter starts editing the selected note; Delete/Backspace delete
  // it — only when not editing text and focus is not in a text control.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (focusIsInTextControl(e.target)) return;
      if (e.key === 'Enter') {
        if (sel.selectedId && !sel.editingId) {
          e.preventDefault();
          sel.startEdit(sel.selectedId);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel.selectedId && !sel.editingId) {
          e.preventDefault();
          if (deleteObject(doc, sel.selectedId)) {
            sel.select(null);
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sel, doc]);

  // If the note being dragged disappears (deleted elsewhere), drop the flag.
  useEffect(() => {
    if (draggingId && !notes.some((n) => n.id === draggingId)) {
      setDraggingId(null);
    }
  }, [notes, draggingId]);

  const selectedNote = sel.selectedId ? notes.find((n) => n.id === sel.selectedId) : undefined;
  const showNoteToolbar =
    selectedNote !== undefined && sel.editingId === null && draggingId !== selectedNote.id;

  let noteToolbarStyle: React.CSSProperties | undefined;
  if (showNoteToolbar) {
    const centre = worldToScreen(cam.camera, {
      x: selectedNote.x + STICKY_SIZE_WORLD / 2,
      y: selectedNote.y,
    });
    noteToolbarStyle = {
      position: 'fixed',
      left: centre.x,
      top: centre.y - 16,
      transform: 'translate(-50%, -100%)',
      zIndex: 1000,
    };
  }

  return (
    <>
      <BoardViewport
        camera={cam.camera}
        beginPan={cam.beginPan}
        panMove={cam.panMove}
        endPan={cam.endPan}
        wheel={cam.wheel}
        zoomStepIn={cam.zoomStepIn}
        zoomStepOut={cam.zoomStepOut}
        reset={cam.reset}
        setCamera={cam.setCamera}
        onCreateStickyAt={handleCreateStickyAt}
        onEmptyClick={() => sel.select(null)}
      >
        {/* Render in stable id order, NOT z order: notes are stacked via
            `z-index` (which is deterministic from the model's z), and
            reordering the DOM on a z change would detach the node mid-drag,
            releasing its pointer capture and killing the drag. */}
        {[...notes]
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .map((n) => (
          <StickyNote
            key={n.id}
            note={n}
            doc={doc}
            zoom={cam.camera.zoom}
            selected={sel.selectedId === n.id}
            editing={sel.editingId === n.id}
            onSelect={sel.select}
            onStartEdit={sel.startEdit}
            onEndEdit={sel.endEdit}
            onDragChange={(d) => setDraggingId(d ? n.id : null)}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={handleCreateStickyCentred} />
      {showNoteToolbar && (
        <div style={noteToolbarStyle}>
          <NoteToolbar
            color={selectedNote.color}
            onColor={(c) => setStickyColor(doc, selectedNote.id, c)}
            onDelete={() => {
              if (deleteObject(doc, selectedNote.id)) sel.select(null);
            }}
          />
        </div>
      )}
      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={cam.zoomStepIn}
        onZoomOut={cam.zoomStepOut}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated && notes.length === 0} />
    </>
  );
}
