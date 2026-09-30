import { useCallback, useEffect, useRef, useState } from 'react';
import { checkBoard } from '../api';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { Toolbar } from '../board/Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { NoteToolbar } from '../objects/NoteToolbar';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { useCamera } from '../canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent, screenToWorld, worldToScreen } from '../canvas/camera';
import type { Size, Point } from '../canvas/camera';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../sync/connectBoard';
import { createSticky, deleteObject, setStickyColor } from '../../shared/board-model';
import { STICKY_SIZE_WORLD, type StickyColor } from '../../shared/config';
import { nextBoardPageState, type BoardPageState } from './state';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';

/**
 * Story 5: board page (share.open_link, share.not_found).
 * On open: show "Opening board…", check existence with exponential backoff
 * (1 s → 2 s → …), render the board only when it exists, the not-found
 * page when it does not, and "Couldn't reach vidi6. Retrying…" while
 * unreachable (the board opens automatically once the service recovers).
 */
export function BoardPage(props: { id: string }) {
  const { id } = props;
  const [state, setState] = useState<BoardPageState>({ kind: 'checking' });
  const attemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runCheck = async () => {
      const attempt = ++attemptRef.current;
      setState({ kind: 'checking' });
      const result = await checkBoard(id);
      if (cancelled) return;
      const next = nextBoardPageState({ kind: 'checking' }, result, attempt);
      if (next.kind === 'ready') {
        setState({ kind: 'ready', boardId: id });
      } else if (next.kind === 'unreachable') {
        setState(next);
        timer = setTimeout(runCheck, next.nextRetryMs);
      } else {
        setState(next);
      }
    };

    runCheck();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [id]);

  if (state.kind === 'checking') {
    return <MessageScreen data-testid="board-checking" message="Opening board…" />;
  }
  if (state.kind === 'unreachable') {
    return (
      <MessageScreen data-testid="board-unreachable" message="Couldn't reach vidi6. Retrying…" />
    );
  }
  if (state.kind === 'not_found') {
    return <NotFoundPage />;
  }

  // ready: the board (stories 1–4 UI) + the Share button (top-right)
  return (
    <>
      <Board boardId={state.boardId} />
      <div style={{ position: 'fixed', top: 12, right: 12, zIndex: 40 }}>
        <SharePanel boardId={state.boardId} />
      </div>
    </>
  );
}

function MessageScreen(props: { 'data-testid': string; message: string }) {
  return (
    <div
      data-testid={props['data-testid']}
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
        color: '#555',
        fontSize: 16,
      }}
    >
      {props.message}
    </div>
  );
}

/**
 * The board (stories 1–4 UI), extracted from App.tsx. Mounted by BoardPage
 * only after the existence check succeeds.
 */
function Board({ boardId }: { boardId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const cam = useCamera(viewport);

  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const sel = useSelection();
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    (window as any).__VIDI_DEBUG__ = { doc };
  }, [doc]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Zoom keyboard shortcuts (story 1)
  const zoomStep = cam.zoomStep;
  const reset = cam.reset;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zoomStep, reset]);

  // Sticky note creation (gated by canEdit)
  const editable = canEdit(connectionState);
  const createAtScreen = useCallback(
    (screenPoint: Point) => {
      if (!editable) return;
      const world = screenToWorld(cam.camera, screenPoint);
      const id = createSticky(doc, world);
      if (id) sel.startEdit(id);
    },
    [cam.camera, doc, sel, editable],
  );

  const createAtCenter = useCallback(() => {
    if (!editable) return;
    const center: Point = { x: viewport.width / 2, y: viewport.height / 2 };
    createAtScreen(center);
  }, [createAtScreen, viewport.width, viewport.height, editable]);

  const handleClearSelection = useCallback(() => {
    sel.select(null);
  }, [sel]);

  const handleDeleteSelected = useCallback(() => {
    if (!editable) return;
    if (sel.selectedId) {
      deleteObject(doc, sel.selectedId);
      sel.select(null);
    }
  }, [doc, sel, editable]);

  const handleColor = useCallback(
    (c: StickyColor) => {
      if (!editable) return;
      if (sel.selectedId) setStickyColor(doc, sel.selectedId, c);
    },
    [doc, sel, editable],
  );

  // Sticky note keyboard: Enter edits the selected note; Delete/Backspace deletes it.
  // Ignored while editing text (the textarea handles those keys) or in any input.
  const selectedId = sel.selectedId;
  const editingId = sel.editingId;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === 'TEXTAREA' ||
          target.tagName === 'INPUT' ||
          target.isContentEditable);
      if (inField) return;

      if (e.key === 'Enter') {
        if (selectedId && editingId === null) {
          e.preventDefault();
          sel.startEdit(selectedId);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId && editingId === null) {
          e.preventDefault();
          handleDeleteSelected();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, editingId, sel, handleDeleteSelected]);

  // Clear selection/editing when a note is deleted remotely
  useEffect(() => {
    if (selectedId && !notes.some((n) => n.id === selectedId)) {
      sel.select(null);
    }
    if (editingId && !notes.some((n) => n.id === editingId)) {
      sel.endEdit('unselected');
    }
  }, [notes, selectedId, editingId, sel]);

  // Render notes in a stable order (by id) so that changing a note's z (e.g.
  // bringToFront during a drag) only changes its z-index and never reorders the
  // DOM. Reordering a DOM node mid-drag would reset the active pointer capture.
  // Visual stacking is handled by each note's z-index.
  const orderedNotes = [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const selectedNote = notes.find((n) => n.id === selectedId);
  const showNoteToolbar =
    !!selectedNote && editingId === null && draggingId === null;

  let noteToolbarPos: { left: number; top: number } | null = null;
  if (selectedNote && showNoteToolbar) {
    const tl = worldToScreen(cam.camera, { x: selectedNote.x, y: selectedNote.y });
    noteToolbarPos = {
      left: tl.x + (STICKY_SIZE_WORLD * cam.camera.zoom) / 2,
      top: tl.y - 8,
    };
  }

  return (
    <div ref={containerRef} style={{ position: 'fixed', inset: 0 }}>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cam.camera}
        beginPan={cam.beginPan}
        panMove={cam.panMove}
        endPan={cam.endPan}
        wheel={cam.wheel}
        onCreateStickyAt={createAtScreen}
        onClearSelection={handleClearSelection}
      >
        {orderedNotes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={cam.camera.zoom}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            onSelect={sel.select}
            onStartEdit={sel.startEdit}
            onEndEdit={sel.endEdit}
            onDragStateChange={(dragging) => setDraggingId(dragging ? note.id : null)}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtCenter} disabled={!editable} />
      {showNoteToolbar && selectedNote && noteToolbarPos && (
        <div
          style={{
            position: 'fixed',
            left: noteToolbarPos.left,
            top: noteToolbarPos.top,
            transform: 'translate(-50%, -100%)',
            zIndex: 30,
          }}
        >
          <NoteToolbar
            color={selectedNote.color}
            onColor={handleColor}
            onDelete={handleDeleteSelected}
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
