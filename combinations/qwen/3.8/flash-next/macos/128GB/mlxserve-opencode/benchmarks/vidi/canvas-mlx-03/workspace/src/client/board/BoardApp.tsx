// The board page's component tree (stories 1-4), mounted by `BoardPage` only once
// the board's link has been checked (story 5): camera, sticky notes, live
// collaboration and the persistence states — and the Share control in the header.
// Nothing in here (Yjs doc, WebSocket, canvas) ever exists for a link that is not
// a board, which is what share.not_found's "nothing is created there" means on
// the client side.

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../canvas/BoardViewport.tsx';
import { ZoomControls } from '../canvas/ZoomControls.tsx';
import { NavigationHint } from '../canvas/NavigationHint.tsx';
import { Toolbar } from './Toolbar.tsx';
import { StickyNote } from '../objects/StickyNote.tsx';
import { NoteToolbar } from '../objects/NoteToolbar.tsx';
import { useCamera } from '../canvas/useCamera.ts';
import { useBoardDoc } from './useBoardDoc.ts';
import { useSelection } from './useSelection.ts';
import { ConnectionStatus, type ConnectionState } from './ConnectionStatus.tsx';
import SharePanel from './SharePanel.tsx';
import { isValidBoardId } from '../../shared/board-id.ts';
import {
  canZoomIn,
  canZoomOut,
  zoomPercent,
  screenToWorld,
  worldToScreen,
  type Size,
  type Point,
} from '../canvas/camera.ts';
import {
  createSticky,
  deleteObject,
  setStickyColor,
} from '../../shared/board-model.ts';
import type { StickyColor } from '../../shared/config.ts';

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export interface BoardAppProps {
  /** Component tests inject their own document; production omits this. */
  doc?: Y.Doc;
  /** Board id from the /b/:boardId route; component tests may omit it. */
  boardId?: string | null;
  /** Component tests force a connection state (TC-23); production omits it. */
  connection?: ConnectionState;
}

/**
 * Whether the board may be edited. Everything except a board whose storage could
 * not be read is editable: a reconnecting board still shows its last known state
 * and its changes are retried (persist.save_failure), while a board that failed to
 * load would silently write into an empty document.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/** Read the board id from a /b/<valid id> path, or null (local board). */
export function boardIdFromPath(path: string): string | null {
  const m = /^\/b\/([^/]+)/.exec(path);
  const id = m?.[1];
  return id && isValidBoardId(id) ? id : null;
}

/**
 * The board page's tree: camera (story 1), sticky notes (story 2), live
 * collaboration (story 3), persistence states (story 4) — and, since story 5, the
 * Share control in the header (share.copy).
 *
 * `BoardPage` mounts this only after the link has been checked, so nothing here
 * (Yjs doc, WebSocket, canvas) ever exists for a link that is not a board.
 */
export default function BoardApp(props: BoardAppProps = {}) {
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
  const { doc, notes, connection } = useBoardDoc(props.doc, boardId, props.connection);
  const sel = useSelection();
  const selRef = useRef(sel);
  selRef.current = sel;

  // Editing gates read the state through a ref so the window-level handlers
  // registered once can never act on a stale state.
  const editable = canEdit(connection);
  const editableRef = useRef(editable);
  editableRef.current = editable;

  const [dragId, setDragId] = useState<string | null>(null);

  const onDragChange = useCallback((id: string, dragging: boolean) => {
    setDragId((prev) => (dragging ? id : prev === id ? null : prev));
  }, []);

  // Create a note centred on a world point, then select + edit it.
  const createAtWorld = useCallback(
    (world: Point) => {
      if (!editableRef.current) return; // a board we could not load is not editable
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
        if (!editableRef.current) return; // editing is locked while the board is unloadable
        if (s.editingId != null || isEditable(e.target)) return;
        if (s.selectedId) {
          e.preventDefault();
          s.startEdit(s.selectedId);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // While editing, these keys edit text — never delete the note.
        if (s.editingId != null || isEditable(e.target)) return;
        if (!editableRef.current) return; // deleting is an edit
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
            editing={editable && sel.editingId === n.id}
            canEdit={editable}
            onSelect={sel.select}
            onStartEdit={sel.startEdit}
            onEndEdit={sel.endEdit}
            onDragChange={onDragChange}
          />
        ))}
      </BoardViewport>

      <Toolbar onCreateSticky={onCreateSticky} disabled={!editable} />

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
              if (!editable) return;
              setStickyColor(doc, selectedNote.id, c); // keeps text/position/selection
            }}
            onDelete={() => {
              if (!editable) return;
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
      {/* Story 5: the board's link, one click away (share.copy). */}
      <SharePanel />
      <ConnectionStatus status={connection} />
    </div>
  );
}
