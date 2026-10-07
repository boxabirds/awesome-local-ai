// App (story 2): wires the board document, selection, camera, toolbars and
// board objects together.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
} from 'react';
import { canZoomIn, canZoomOut, screenToWorld, worldToScreen, zoomPercent, type Point, type Size } from './canvas/camera';
import { useCamera } from './canvas/useCamera';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { NoteToolbar } from './objects/NoteToolbar';
import { createSticky, deleteObject, getStickyText, setStickyColor, snapshot } from '../shared/board-model';
import { STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from '../shared/config';
import { isTestMode, type Vidi6TestHooks } from './testHooks';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { newBoardId } from '../shared/board-id';

/**
 * Story 4 edit gate: editing is disabled only while the board's storage
 * could not be loaded. While `reconnecting` (e.g. after a storage failure
 * close 1011) the board stays editable — unsaved changes are re-sent on
 * reconnection.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/** Gap (screen px) between the note top edge and the note toolbar. */
const NOTE_TOOLBAR_GAP_PX = 8;

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function App(): JSX.Element {
  // Route: /b/:boardId or / (redirect to /b/<newBoardId()>)
  const boardId = useBoardId();
  const { doc, objects, connectionState } = useBoardDoc(boardId);
  const selection = useSelection();
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  // Viewport size from the root element; camera x,y are unchanged on resize.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setSize((s) =>
          s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height },
        );
      }
    };
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, []);

  const cam = useCamera(size);

  // If a selected/edited/dragged note disappears from the document, clear the
  // stale local state (also ends interactions when a note is deleted
  // mid-drag or mid-edit).
  useEffect(() => {
    const ids = new Set(objects.map((n) => n.id));
    if (selection.selectedId && !ids.has(selection.selectedId)) selection.select(null);
    if (selection.editingId && !ids.has(selection.editingId)) selection.endEdit('unselected');
    if (selection.draggingId && !ids.has(selection.draggingId)) selection.setDragging(null);
  }, [objects, selection]);

  const createStickyAt = useCallback(
    (screen: Point) => {
      if (!canEdit(connectionState)) return; // story 4: edit lock
      const world = screenToWorld(cam.camera, screen);
      const id = createSticky(doc, world);
      if (id) {
        // The new note is selected and starts editing immediately, so typed
        // characters go straight into it.
        selection.select(id);
        selection.startEdit(id);
      }
    },
    [cam.camera, doc, selection, connectionState],
  );

  // Keyboard: Enter starts editing the selected note; Delete/Backspace delete
  // the selected note. Both are ignored while text is being edited (the keys
  // then go to the textarea) or while focus is in any input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (!canEdit(connectionState)) return; // story 4: edit lock
      if (e.key === 'Enter') {
        if (selection.selectedId && !selection.editingId) {
          e.preventDefault();
          selection.startEdit(selection.selectedId);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.selectedId && !selection.editingId) {
          e.preventDefault();
          if (deleteObject(doc, selection.selectedId)) selection.select(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, selection, connectionState]);

  // Test hooks (test mode only).
  useEffect(() => {
    if (!isTestMode()) return;
    const hooks: Vidi6TestHooks = {
      doc,
      getCamera: () => cam.camera,
      setCamera: (c) => cam.setCamera(c),
      getNotes: () =>
        snapshot(doc).map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          color: n.color,
          text: n.text,
          z: n.z,
        })),
      getConnectionState: () => connectionState,
      createNote: () => {
        createStickyAt({ x: size.width / 2, y: size.height / 2 });
      },
      createNoteAt: (x, y, color, text) => {
        const stickyColor: StickyColor | undefined =
          Object.keys(STICKY_COLORS).includes(color) ? (color as StickyColor) : undefined;
        const id = createSticky(doc, { x, y }, stickyColor);
        if (id !== null && text !== undefined && text !== '') {
          getStickyText(doc, id)?.insert(0, text);
        }
        return id;
      },
    };
    window.__vidi6 = hooks;
    return () => {
      delete window.__vidi6;
    };
  }, [doc, cam.camera, cam.setCamera, connectionState, size, createStickyAt]);

  const selectedNote = objects.find((n) => n.id === selection.selectedId) ?? null;
  const noteToolbarVisible =
    selectedNote !== null &&
    selection.editingId !== selectedNote.id &&
    selection.draggingId !== selectedNote.id;

  return (
    <div ref={rootRef} className="board-root" data-testid="board-root">
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cam.camera}
        size={size}
        onBeginPan={cam.beginPan}
        onPanMove={cam.panMove}
        onEndPan={cam.endPan}
        onWheel={cam.wheel}
        onZoomStep={cam.zoomStep}
        onReset={cam.reset}
        onCreateStickyAt={createStickyAt}
        onEmptyClick={() => selection.select(null)}
      >
        {/* Notes render in a stable DOM order (by id); visual stacking comes
            from each note's CSS z-index. Reordering the DOM when z changes
            would move the element of an in-flight drag and break its pointer
            capture, so DOM order must never follow z. */}
        {[...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={cam.camera.zoom}
            selected={selection.selectedId === note.id}
            editing={selection.editingId === note.id}
            disabled={!canEdit(connectionState)}
            onSelect={selection.select}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
            onDragChange={(dragging) => selection.setDragging(dragging ? note.id : null)}
          />
        ))}
      </BoardViewport>

      <Toolbar
        disabled={!canEdit(connectionState)}
        onCreateSticky={() => createStickyAt({ x: size.width / 2, y: size.height / 2 })}
      />

      {noteToolbarVisible && selectedNote && (
        <div
          className="note-toolbar-anchor"
          style={{
            left: worldToScreen(cam.camera, {
              x: selectedNote.x + STICKY_SIZE_WORLD / 2,
              y: selectedNote.y,
            }).x,
            top:
              worldToScreen(cam.camera, { x: selectedNote.x, y: selectedNote.y }).y -
              NOTE_TOOLBAR_GAP_PX,
          }}
        >
          <NoteToolbar
            color={selectedNote.color}
            onColor={(c) => {
              if (!canEdit(connectionState)) return; // story 4: edit lock
              setStickyColor(doc, selectedNote.id, c);
            }}
            onDelete={() => {
              if (!canEdit(connectionState)) return; // story 4: edit lock
              if (deleteObject(doc, selectedNote.id)) selection.select(null);
            }}
          />
        </div>
      )}

      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />

      <NavigationHint visible={!cam.hasNavigated} />
    </div>
  );
}

/**
 * Reads the board id from the URL path. If at `/`, redirects to `/b/<newBoardId()>`.
 * If at `/b/:boardId`, returns the boardId.
 */
function useBoardId(): string | undefined {
  const path = window.location.pathname;
  if (path === '/' || path === '') {
    // Redirect to a new board
    const id = newBoardId();
    window.history.replaceState(null, '', `/b/${id}`);
    return id;
  }
  const match = path.match(/^\/b\/([^/]+)$/);
  if (match) return match[1];
  return undefined;
}
