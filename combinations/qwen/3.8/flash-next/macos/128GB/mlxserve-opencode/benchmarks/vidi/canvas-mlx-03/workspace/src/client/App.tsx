import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport.tsx';
import { ZoomControls } from './canvas/ZoomControls.tsx';
import { NavigationHint } from './canvas/NavigationHint.tsx';
import { Toolbar } from './board/Toolbar.tsx';
import { StickyNote } from './objects/StickyNote.tsx';
import { NoteToolbar } from './objects/NoteToolbar.tsx';
import { useCamera } from './canvas/useCamera.ts';
import { useBoardDoc } from './board/useBoardDoc.ts';
import { useSelection } from './board/useSelection.ts';
import { ConnectionStatus } from './board/ConnectionStatus.tsx';
import { isValidBoardId } from '../shared/board-id.ts';
import {
  canZoomIn,
  canZoomOut,
  zoomPercent,
  screenToWorld,
  worldToScreen,
  type Size,
  type Point,
} from './canvas/camera.ts';
import {
  createSticky,
  deleteObject,
  setStickyColor,
} from '../shared/board-model.ts';
import type { StickyColor } from '../shared/config.ts';

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export interface AppProps {
  /** Component tests inject their own document; production omits this. */
  doc?: Y.Doc;
  /** Board id from the /b/:boardId route; component tests may omit it. */
  boardId?: string | null;
}

/** Read the board id from a /b/<valid id> path, or null (local board). */
export function boardIdFromPath(path: string): string | null {
  const m = /^\/b\/([^/]+)/.exec(path);
  const id = m?.[1];
  return id && isValidBoardId(id) ? id : null;
}

/**
 * Top-level board: camera (story 1) plus sticky notes (story 2). Wires the Y.Doc
 * snapshot, local selection, the left toolbar, the per-note toolbar and the
 * window-level Enter / Delete / Backspace shortcuts.
 */
export default function App(props: AppProps = {}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Size>({ width: 1280, height: 800 });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setViewport({ width: r.width, height: r.height });
    });
    ro.observe(el);
    setViewport({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const cam = useCamera(viewport);
  const boardId = props.boardId ?? boardIdFromPath(window.location.pathname);
  const { doc, notes, connection } = useBoardDoc(props.doc, boardId);
  const sel = useSelection();
  const selRef = useRef(sel);
  selRef.current = sel;

  const [dragId, setDragId] = useState<string | null>(null);

  const onDragChange = useCallback((id: string, dragging: boolean) => {
    setDragId((prev) => (dragging ? id : prev === id ? null : prev));
  }, []);

  // Create a note centred on a world point, then select + edit it.
  const createAtWorld = useCallback(
    (world: Point) => {
      const id = createSticky(doc, world);
      selRef.current.startEdit(id);
    },
    [doc],
  );

  // Toolbar button: centred in the visible board area.
  const onCreateSticky = useCallback(() => {
    const centre = { x: viewport.width / 2, y: viewport.height / 2 };
    createAtWorld(screenToWorld(cam.camera, centre));
  }, [createAtWorld, viewport.width, viewport.height, cam.camera]);

  // Empty-space press clears selection (and any in-progress edit).
  const onBackgroundPointerDown = useCallback(() => {
    selRef.current.select(null);
  }, []);

  // Window shortcuts: Enter edits the selected note; Delete/Backspace deletes it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = selRef.current;
      if (e.key === 'Enter') {
        if (s.editingId != null || isEditable(e.target)) return;
        if (s.selectedId) {
          e.preventDefault();
          s.startEdit(s.selectedId);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // While editing, these keys edit text — never delete the note.
        if (s.editingId != null || isEditable(e.target)) return;
        if (s.selectedId) {
          e.preventDefault();
          deleteObject(doc, s.selectedId);
          s.select(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc]);

  const stop = (e: React.PointerEvent | React.MouseEvent | React.WheelEvent) =>
    e.stopPropagation();

  const selectedNote = notes.find((n) => n.id === sel.selectedId) ?? null;
  const showNoteToolbar =
    selectedNote != null &&
    sel.editingId !== selectedNote.id &&
    dragId !== selectedNote.id;

  let noteToolbarStyle: React.CSSProperties = { position: 'fixed', left: -9999, top: -9999 };
  if (selectedNote) {
    const s = worldToScreen(cam.camera, { x: selectedNote.x, y: selectedNote.y });
    noteToolbarStyle = { position: 'fixed', left: s.x, top: Math.max(4, s.y - 46), zIndex: 30 };
  }

  return (
    <div data-testid="app" className="vidi6-root">
      <BoardViewport
        camera={cam.camera}
        viewportRef={viewportRef}
        api={cam}
        onBackgroundPointerDown={onBackgroundPointerDown}
        onBackgroundDoubleClick={createAtWorld}
      >
        {notes.map((n) => (
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
            onDragChange={onDragChange}
          />
        ))}
      </BoardViewport>

      <Toolbar onCreateSticky={onCreateSticky} />

      {showNoteToolbar && selectedNote ? (
        <div
          data-testid="note-toolbar-anchor"
          style={noteToolbarStyle}
          onPointerDown={stop}
          onDoubleClick={stop}
          onWheel={stop}
        >
          <NoteToolbar
            color={selectedNote.color}
            onColor={(c: StickyColor) => {
              setStickyColor(doc, selectedNote.id, c); // keeps text/position/selection
            }}
            onDelete={() => {
              deleteObject(doc, selectedNote.id);
              sel.select(null);
            }}
          />
        </div>
      ) : null}

      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
      <ConnectionStatus status={connection} />
    </div>
  );
}
