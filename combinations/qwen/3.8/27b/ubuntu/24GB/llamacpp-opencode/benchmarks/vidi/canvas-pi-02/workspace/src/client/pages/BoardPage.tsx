/**
 * Board page (story 5, share.pages).
 *
 * States:
 *   malformed id    → NotFoundPage (no request sent)
 *   checking        → "Opening board…"
 *   ready           → board UI (stories 1-4) + SharePanel
 *   not_found       → NotFoundPage
 *   unreachable     → "Couldn't reach vidi6. Retrying…" with backoff
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import {
  BOARD_CHECK_RETRY_BASE_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';
import { checkBoard } from '../api';
import { NotFoundPage } from './NotFoundPage';
import { SharePanel } from '../share/SharePanel';
import type { Size } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';

/**
 * Edit gate: the board is editable in every phase except `load_failed`
 * (room rejected the sync; retrying). `null` (local mode / test harness) is
 * editable.
 */
export function canEdit(phase: ConnectionState | null): boolean {
  return phase !== 'load_failed';
}
import { canZoomIn, canZoomOut, worldToScreen, zoomPercent } from '../canvas/camera';
import { useCamera } from '../canvas/useCamera';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useBoardActions } from '../board/useBoardActions';
import { useBoardKeys } from '../board/useBoardKeys';
import { useTransformGesture } from '../board/useTransformGesture';
import { createUndo } from '../board/undo';
import { useUndo } from '../board/useUndo';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { Toolbar } from '../board/Toolbar';
import { getObjectType } from '../objects/registry';
import { deleteObjects, hasObject, objectBounds } from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';

type BoardPageState = 'checking' | 'ready' | 'not_found' | 'unreachable';

export function BoardPage({ id }: { id: string }) {
  // Malformed id → immediate NotFoundPage, no request.
  if (!isValidBoardId(id)) {
    return <NotFoundPage />;
  }
  return <BoardPageInner id={id} />;
}

function BoardPageInner({ id }: { id: string }) {
  const [state, setState] = useState<BoardPageState>('checking');
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const unmountedRef = useRef(false);

  // Board existence check with exponential backoff.
  const doCheck = useCallback(async () => {
    const result = await checkBoard(id);
    if (unmountedRef.current) return;
    if (result.kind === 'exists') {
      setState('ready');
    } else if (result.kind === 'not_found') {
      setState('not_found');
    } else {
      // unreachable: schedule a retry with exponential backoff
      setState('unreachable');
      const attempt = attemptRef.current;
      attemptRef.current += 1;
      const delay = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * 2 ** attempt,
        RECONNECT_MAX_BACKOFF_MS,
      );
      retryTimerRef.current = setTimeout(() => {
        doCheck();
      }, delay);
    }
  }, [id]);

  useEffect(() => {
    unmountedRef.current = false;
    doCheck();
    return () => {
      unmountedRef.current = true;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [doCheck]);

  if (state === 'checking') {
    return (
      <div className="vidi6-board-loading" data-testid="board-loading">
        Opening board…
      </div>
    );
  }

  if (state === 'not_found') {
    return <NotFoundPage />;
  }

  if (state === 'unreachable') {
    return (
      <div className="vidi6-board-unreachable" data-testid="board-unreachable">
        Couldn't reach vidi6. Retrying…
      </div>
    );
  }

  // state === 'ready': render the board UI. The key remounts the whole
  // content (fresh doc connection AND a fresh per-user undo history) when
  // navigating between boards.
  return <BoardContent key={id} id={id} />;
}

/**
 * The actual board UI (stories 1-4). Rendered only when the board exists.
 */
function BoardContent({ id }: { id: string }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({ width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const api = useCamera(size);
  const { doc, notes, connectionPhase } = useBoardDoc(id);
  // One per-user undo controller per doc (story 8, undo.history). Session
  // only: destroyed on unmount, a fresh one starts empty (undo.session_only).
  const [undo] = useState(() => createUndo(doc));
  useEffect(() => () => undo.destroy(), [undo]);
  const selection = useSelection(notes, (id) => hasObject(doc, id));
  const editable = canEdit(connectionPhase);
  const undoState = useUndo(undo, editable);
  const boundary = useCallback(() => undo.boundary(), [undo]);
  const actions = useBoardActions({ doc, api, size, selection, editable });
  const gesture = useTransformGesture({
    doc,
    camera: api.camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    // Step boundaries (story 8, undo.boundaries): one gesture = one step.
    onGestureStart: boundary,
    onGestureEnd: boundary,
  });
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: editable, undo });
  const marquee = useMarquee(api.camera, notes, (ids) => selection.setMany(ids, true));

  // Creation and deletion are single steps (story 8, undo.boundaries).
  const createStickyAt = (point: Parameters<typeof actions.createAtScreenPoint>[0]) => {
    boundary();
    actions.createAtScreenPoint(point);
    boundary();
  };
  const createStickyCentre = () => {
    boundary();
    actions.createAtCentre();
    boundary();
  };

  const deleteSelection = () => {
    if (!editable) return;
    boundary();
    if (deleteObjects(doc, [...selection.ids]) > 0) selection.clear();
    boundary();
  };

  // Bounding box of the selection (world units) → the bar's anchor (screen).
  const selectedObjects = notes.filter((o) => selection.ids.has(o.id));
  const box = unionRects(selectedObjects.map(objectBounds));
  let barAnchor: { x: number; y: number } | null = null;
  if (box !== null) {
    const topLeft = worldToScreen(api.camera, { x: box.x, y: box.y });
    barAnchor = { x: topLeft.x + (box.width * api.camera.zoom) / 2, y: topLeft.y - 8 };
  }

  return (
    <div className="vidi6-shell" ref={shellRef}>
      <BoardViewport
        api={api}
        onCreateStickyAt={createStickyAt}
        onEmptyClick={() => selection.clear()}
        marquee={marquee}
      >
        {notes.map((note) => {
          // Unknown object types stay in the doc untouched (no renderer yet).
          const spec = getObjectType(note.type);
          if (spec === undefined) return null;
          const Component = spec.Component;
          return (
            <Component
              key={note.id}
              obj={note}
              doc={doc}
              zoom={api.camera.zoom}
              selected={selection.ids.has(note.id)}
              editing={selection.editingId === note.id}
              editable={editable}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onSelect={selection.click}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
              undo={undo}
            />
          );
        })}
      </BoardViewport>
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={api.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <MarqueeRect rect={marquee.rect} camera={api.camera} />
      {barAnchor !== null && selection.editingId === null && (
        <div
          className="vidi6-selection-bar-anchor"
          style={{ left: barAnchor.x, top: barAnchor.y }}
        >
          <SelectionBar
            ids={selection.ids}
            snapshot={notes}
            doc={doc}
            editable={editable}
            onDelete={deleteSelection}
            boundary={boundary}
          />
        </div>
      )}
      <Toolbar onCreateSticky={createStickyCentre} disabled={!editable} undo={undoState} />
      <ConnectionStatus phase={connectionPhase} />
      <ZoomControls
        zoomPercent={zoomPercent(api.camera)}
        canZoomIn={canZoomIn(api.camera)}
        canZoomOut={canZoomOut(api.camera)}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />
      <SharePanel boardId={id} />
    </div>
  );
}
