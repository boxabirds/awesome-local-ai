import { useCallback, useEffect, useRef, useState } from 'react';
import { checkBoard } from '../api';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useMarquee } from '../board/useMarquee';
import { useTransformGesture } from '../board/useTransformGesture';
import { useBoardKeys } from '../board/useBoardKeys';
import { Toolbar } from '../board/Toolbar';
import { SelectionBar } from '../board/SelectionBar';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { MarqueeRect } from '../board/Marquee';
import { getObjectType } from '../objects/registry';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { useCamera } from '../canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent, screenToWorld, worldToScreen } from '../canvas/camera';
import type { Size, Point } from '../canvas/camera';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../sync/connectBoard';
import {
  createSticky,
  deleteObjects,
  setStickyColor,
  objectBounds,
} from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import type { StickyColor } from '../../shared/config';
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
  const sel = useSelection(notes);

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
    sel.clear();
  }, [sel]);

  const handleDeleteSelection = useCallback(() => {
    if (!editable) return;
    const ids = [...sel.ids];
    if (ids.length === 0) return;
    deleteObjects(doc, ids);
    sel.clear();
  }, [doc, sel, editable]);

  const handleColor = useCallback(
    (c: StickyColor) => {
      if (!editable) return;
      for (const id of sel.ids) setStickyColor(doc, id, c);
    },
    [doc, sel, editable],
  );

  // Marquee selection (Shift+drag on empty space), story 7.
  const marquee = useMarquee(cam.camera, notes, (ids) => sel.setMany(ids, true));
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;

  // The generic transform gesture: group move + bounding-box resize, story 7.
  const gesture = useTransformGesture({
    doc,
    camera: cam.camera,
    selection: sel,
    snapshot: notes,
    canEdit: editable,
  });

  const handleObjectPointerDown = useCallback(
    (e: PointerEvent, id: string) => {
      if (e.shiftKey) {
        sel.toggle(id);
        return;
      }
      gesture.onObjectPointerDown(e, id);
    },
    [gesture, sel],
  );

  // Keyboard commands: select-all, Escape, nudge, delete, Enter-to-edit.
  useBoardKeys({
    doc,
    selection: sel,
    snapshot: notes,
    canEdit: editable,
    escapeHandler: () => {
      if (marqueeRef.current.rect) {
        marqueeRef.current.cancel();
        return true;
      }
      return false;
    },
  });

  // Render objects in a stable order (by id) so that changing an object's z
  // (e.g. bringObjectsToFront during a drag) only changes its z-index and
  // never reorders the DOM. Reordering a DOM node mid-drag would reset the
  // active pointer capture. Visual stacking is handled by z-index.
  const orderedObjects = [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // The selection bar floats above the selection's bounding box.
  const selectedObjs = notes.filter((o) => sel.ids.has(o.id));
  const selectionBox = unionRects(selectedObjs.map(objectBounds));
  const showBar = selectionBox !== null && sel.editingId === null;
  let barPos: { left: number; top: number } | null = null;
  if (selectionBox && showBar) {
    const p = worldToScreen(cam.camera, { x: selectionBox.x + selectionBox.width / 2, y: selectionBox.y });
    barPos = { left: p.x, top: p.y - 8 };
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
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
      >
        {orderedObjects.map((o) => {
          const spec = getObjectType(o.type);
          if (!spec) return null;
          const C = spec.Component;
          return (
            <C
              key={o.id}
              obj={o}
              doc={doc}
              zoom={cam.camera.zoom}
              selected={sel.ids.has(o.id)}
              editing={sel.editingId === o.id}
              onPointerDown={handleObjectPointerDown}
              onStartEdit={sel.startEdit}
              onEndEdit={(next) => {
                sel.endEdit();
                if (next === 'unselected') sel.clear();
              }}
            />
          );
        })}
        <SelectionOverlay
          ids={sel.ids}
          snapshot={notes}
          camera={cam.camera}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
        <MarqueeRect rect={marquee.rect} camera={cam.camera} />
      </BoardViewport>
      <Toolbar onCreateSticky={createAtCenter} disabled={!editable} />
      {barPos && (
        <div
          style={{
            position: 'fixed',
            left: barPos.left,
            top: barPos.top,
            transform: 'translate(-50%, -100%)',
            zIndex: 30,
          }}
        >
          <SelectionBar
            ids={sel.ids}
            snapshot={notes}
            onDelete={handleDeleteSelection}
            onColor={handleColor}
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
