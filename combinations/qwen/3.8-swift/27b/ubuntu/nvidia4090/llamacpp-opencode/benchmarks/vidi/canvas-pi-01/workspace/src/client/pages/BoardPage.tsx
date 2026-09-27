// Board page (spec: share.pages state diagram):
//   - malformed id → NotFoundPage, no request;
//   - "Opening board…" while checkBoard runs;
//   - exists → the stories 1–7 board (mounts + connectBoard);
//   - not_found → NotFoundPage;
//   - unreachable → "Couldn't reach vidi6. Retrying…" with exponential
//     backoff from BOARD_CHECK_RETRY_BASE_MS, capped at RECONNECT_MAX_BACKOFF_MS.
// All timers are cleared on unmount.

import { useEffect, useRef, useState } from 'react';
import { checkBoard } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
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
import { useTransformGesture } from '../board/useTransformGesture';
import { useBoardKeys } from '../board/useBoardKeys';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { SelectionBar } from '../board/SelectionBar';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { Toolbar } from '../board/Toolbar';
import { getObjectType } from '../objects/registry';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { SharePanel } from '../share/SharePanel';
import {
  createSticky,
  deleteObjects,
  objectBounds,
  setStickyColor,
} from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
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

/** Gap (screen px) between the selection bar and the box's top edge. */
const NOTE_TOOLBAR_GAP_PX = 8;
/** Selection bar height (screen px); the anchor sits that far above. */
const NOTE_TOOLBAR_HEIGHT_PX = 40;

/** The full board surface (stories 1–7) plus the Share button (story 5). */
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
  const { doc, notes, connectionState, setConnectionState } = useBoardDoc(boardId);
  const editable = canEdit(connectionState);
  const selection = useSelection(notes);

  // Transform gesture: moving (pointer-down on an object) and resizing
  // (pointer-down on an overlay handle) share one implementation.
  const gestureLogRef = useRef({ starts: 0, ends: 0 });
  const gesture = useTransformGesture({
    doc,
    camera: cam.camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    onGestureStart: () => {
      gestureLogRef.current.starts += 1;
    },
    onGestureEnd: () => {
      gestureLogRef.current.ends += 1;
    },
  });

  // Marquee (Shift+drag) selection: additive, fully-contained objects only.
  const marquee = useMarquee(cam.camera, notes, (ids) => selection.setMany(ids, true));


  // Keyboard shortcuts: Ctrl+A, Escape, arrows, Delete, Enter.
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: editable });

  // Test-only hook (excluded from production builds).
  useEffect(() => {
    installTestHooks({
      setCamera: cam.setCamera,
      getDoc: () => doc,
      createNoteAt: (x: number, y: number) => createSticky(doc, { x, y }),
      deleteNote: (id: string) => deleteObjects(doc, [id]) > 0,
      connectionState,
      setConnectionState,
      getGestureLog: () => ({ ...gestureLogRef.current }),
    });
  }, [cam.setCamera, doc, connectionState, setConnectionState]);

  /** Create a note centred on a screen point, then select and start editing it. */
  const createStickyAt = (screenPoint: { x: number; y: number }) => {
    if (!editable) return; // load_failed: no model mutation (persist.client_status)
    const world = screenToWorld(cam.camera, screenPoint);
    const id = createSticky(doc, world);
    selection.startEdit(id);
  };

  const selectedObjects = notes.filter((n) => selection.ids.has(n.id));
  const showBar =
    editable &&
    selection.editingId === null &&
    (selectedObjects.length >= 2 ||
      (selectedObjects.length === 1 && selectedObjects[0] !== undefined && selectedObjects[0].type === 'sticky'));

  // Selection bar + overlay: screen space, anchored on the bounding box.
  let selectionBar = null;
  if (showBar) {
    const box = unionRects(selectedObjects.map(objectBounds));
    if (box !== null) {
      const anchor = worldToScreen(cam.camera, { x: box.x + box.width / 2, y: box.y });
      selectionBar = (
        <div
          className="note-toolbar-anchor"
          style={{
            left: anchor.x,
            top: anchor.y - NOTE_TOOLBAR_GAP_PX - NOTE_TOOLBAR_HEIGHT_PX,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <SelectionBar
            ids={selection.ids}
            snapshot={notes}
            onColor={(color) => {
              const [id] = selection.ids.values();
              if (id !== undefined) setStickyColor(doc, id, color);
            }}
            onDelete={() => {
              deleteObjects(doc, [...selection.ids]);
              selection.clear();
            }}
          />
        </div>
      );
    }
  }

  return (
    <div ref={rootRef} className="app-root">
      <BoardViewport
        cam={cam}
        onEmptyClick={() => selection.clear()}
        onCreateStickyAt={createStickyAt}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
      >
        <MarqueeRect rect={marquee.rect} />
        {notes.map((note) => {
          const spec = getObjectType(note.type);
          if (spec === undefined) return null; // unknown type: not rendered
          const Component = spec.Component;
          return (
            <Component
              key={note.id}
              obj={note}
              doc={doc}
              zoom={cam.camera.zoom}
              selected={selection.ids.has(note.id)}
              editing={selection.editingId === note.id}
              dragging={gesture.draggingIds.has(note.id)}
              editable={editable}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onFocusSelect={(id) => selection.click(id)}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
            />
          );
        })}
      </BoardViewport>
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={cam.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <Toolbar
        disabled={!editable}
        onCreateSticky={() => createStickyAt({ x: size.width / 2, y: size.height / 2 })}
      />
      {selectionBar}
      {selection.ids.size > 0 && (
        <span data-testid="selection-count" aria-live="polite" className="sr-only">
          {selection.ids.size} selected
        </span>
      )}
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
