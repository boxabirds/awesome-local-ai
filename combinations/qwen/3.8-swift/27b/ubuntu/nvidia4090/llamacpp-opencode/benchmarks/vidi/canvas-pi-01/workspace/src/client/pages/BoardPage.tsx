// Board page (spec: share.pages state diagram):
//   - malformed id → NotFoundPage, no request;
//   - "Opening board…" while checkBoard runs;
//   - exists → the stories 1–4 board (mounts + connectBoard);
//   - not_found → NotFoundPage;
//   - unreachable → "Couldn't reach vidi6. Retrying…" with exponential
//     backoff from BOARD_CHECK_RETRY_BASE_MS, capped at RECONNECT_MAX_BACKOFF_MS.
// All timers are cleared on unmount.

import { useEffect, useRef, useState } from 'react';
import { checkBoard } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import {
  BOARD_CHECK_RETRY_BASE_MS,
  RECONNECT_MAX_BACKOFF_MS,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import { BoardViewport } from '../canvas/BoardViewport';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Size,
} from '../canvas/camera';
import { NavigationHint } from '../canvas/NavigationHint';
import { installTestHooks } from '../canvas/testHooks';
import { useCamera } from '../canvas/useCamera';
import { ZoomControls } from '../canvas/ZoomControls';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { Toolbar } from '../board/Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { NoteToolbar } from '../objects/NoteToolbar';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { SharePanel } from '../share/SharePanel';
import { createSticky, deleteObject, setStickyColor } from '../../shared/board-model';
import { NotFoundPage } from './NotFoundPage';

type Phase = 'checking' | 'exists' | 'not_found' | 'unreachable';

export function BoardPage({ id }: { id: string }) {
  // A malformed id never produces a request (TC-19 negative).
  const [phase, setPhase] = useState<Phase>(() =>
    isValidBoardId(id) ? 'checking' : 'not_found',
  );
  // How many checks have already failed (drives the backoff delay).
  const [failedChecks, setFailedChecks] = useState(0);
  const [runId, setRunId] = useState(0); // bump to (re)start a check cycle

  useEffect(() => {
    if (phase === 'exists' || phase === 'not_found') return;
    const delay =
      phase === 'unreachable' && failedChecks > 0
        ? Math.min(
            BOARD_CHECK_RETRY_BASE_MS * 2 ** (failedChecks - 1),
            RECONNECT_MAX_BACKOFF_MS,
          )
        : 0;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void checkBoard(id).then((result) => {
        if (cancelled) return;
        if (result.status === 'exists') {
          setPhase('exists');
        } else if (result.status === 'not_found') {
          setPhase('not_found');
        } else {
          setFailedChecks((n) => n + 1);
          setPhase('unreachable');
          setRunId((n) => n + 1);
        }
      });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [id, phase, failedChecks, runId]);

  if (phase === 'not_found') return <NotFoundPage />;
  if (phase !== 'exists') {
    return (
      <div className="page board-page">
        <p className="page-status" role="status">
          {phase === 'checking' ? 'Opening board…' : 'Couldn’t reach vidi6. Retrying…'}
        </p>
      </div>
    );
  }
  return <Board boardId={id} />;
}

/**
 * Editing is allowed in every connection state except load_failed
 * (spec: persist.client_status). A load_failed board shows the red badge
 * "This board couldn't be loaded. Retrying…" and the provider keeps
 * retrying; the first successful sync re-enables editing without a reload.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/** Gap (screen px) between the note toolbar and the note's top edge. */
const NOTE_TOOLBAR_GAP_PX = 8;
/** Note toolbar height (screen px); the anchor sits that far above the note. */
const NOTE_TOOLBAR_HEIGHT_PX = 40;

/** The full board surface (stories 1–4) plus the Share button (story 5). */
function Board({ boardId }: { boardId: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  // Viewport size from a ResizeObserver; camera x,y are unchanged on resize.
  useEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cam = useCamera(size);
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const editable = canEdit(connectionState);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection(notes);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Test-only hook (excluded from production builds).
  useEffect(() => {
    installTestHooks({
      setCamera: cam.setCamera,
      getDoc: () => doc,
      deleteNote: (id: string) => deleteObject(doc, id),
      connectionState,
    });
  }, [cam.setCamera, doc, connectionState]);

  const selectedNote = selectedId !== null ? (notes.find((n) => n.id === selectedId) ?? null) : null;

  /** Create a note centred on a screen point, then select and start editing it. */
  const createStickyAt = (screenPoint: { x: number; y: number }) => {
    if (!editable) return; // load_failed: no model mutation (persist.client_status)
    const world = screenToWorld(cam.camera, screenPoint);
    const id = createSticky(doc, world);
    startEdit(id);
  };

  // Keyboard: Enter starts editing the selected note; Delete/Backspace delete
  // it. Both are ignored while editing text (the textarea owns the keys) and
  // while focus is in any input.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField =
        target !== null &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
      if (inField || selectedId === null || editingId !== null || !editable) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        startEdit(selectedId);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, editingId, doc, editable, startEdit, select]);

  // Note toolbar: screen space, centred above the selected note. Hidden while
  // the board is load_failed so colour/delete are no-ops too.
  let noteToolbar = null;
  if (editable && selectedNote !== null && editingId === null && draggingId === null) {
    const centre = worldToScreen(cam.camera, {
      x: selectedNote.x + STICKY_SIZE_WORLD / 2,
      y: selectedNote.y,
    });
    noteToolbar = (
      <div
        className="note-toolbar-anchor"
        style={{
          left: centre.x,
          top: centre.y - NOTE_TOOLBAR_GAP_PX - NOTE_TOOLBAR_HEIGHT_PX,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <NoteToolbar
          color={selectedNote.color}
          onColor={(color) => setStickyColor(doc, selectedNote.id, color)}
          onDelete={() => {
            deleteObject(doc, selectedNote.id);
            select(null);
          }}
        />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="app-root">
      <BoardViewport
        cam={cam}
        onEmptyClick={() => select(null)}
        onCreateStickyAt={createStickyAt}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={cam.camera.zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            editable={editable}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
            onDraggingChange={setDraggingId}
          />
        ))}
      </BoardViewport>
      <Toolbar
        disabled={!editable}
        onCreateSticky={() => createStickyAt({ x: size.width / 2, y: size.height / 2 })}
      />
      {noteToolbar}
      <ConnectionStatus state={connectionState} />
      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
      <SharePanel boardId={boardId} />
    </div>
  );
}
