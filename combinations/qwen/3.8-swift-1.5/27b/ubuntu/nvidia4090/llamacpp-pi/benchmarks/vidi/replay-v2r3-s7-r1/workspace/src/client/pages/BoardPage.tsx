import { useCallback, useEffect, useRef, useState } from 'react';
import { checkBoard } from '../api';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useTransformGesture } from '../board/useTransformGesture';
import { useBoardKeys } from '../board/useBoardKeys';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { Toolbar } from '../board/Toolbar';
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
  objectBounds,
  objectsInRect,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import { type StickyColor } from '../../shared/config';
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
 * The board (stories 1–7 UI), extracted from App.tsx. Mounted by BoardPage
 * only after the existence check succeeds.
 */
function Board({ boardId }: { boardId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const cam = useCamera(viewport);

  const { doc, objects, connectionState } = useBoardDoc(boardId);
  const sel = useSelection(objects);

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

  // Story 7: multi-select gestures and keyboard shortcuts.
  const gesture = useTransformGesture({
    doc,
    camera: cam.camera,
    objects,
    selectedIds: sel.ids,
    canEdit: editable,
  });

  const onObjectPointerDown = useCallback(
    (e: PointerEvent, id: string) => {
      if (e.button !== 0) return;
      if (e.shiftKey) {
        // Shift-click: the gesture moves the selection AFTER the toggle.
        const next = new Set(sel.ids);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        sel.toggle(id);
        gesture.onObjectPointerDown(e, [...next]);
      } else if (sel.has(id)) {
        // Dragging an already-selected object moves the whole selection.
        gesture.onObjectPointerDown(e, [...sel.ids]);
      } else {
        // Plain click on an unselected object: it becomes the selection.
        sel.click(id);
        gesture.onObjectPointerDown(e, [id]);
      }
    },
    [sel, gesture],
  );

  const marquee = useMarquee(cam.camera, (rect, additive) => {
    sel.setMany(objectsInRect(objects, rect), additive);
  });

  useBoardKeys({ doc, objects, selection: sel, canEdit: editable });

  const handleClearSelection = useCallback(() => {
    sel.clear();
  }, [sel]);

  const handleDeleteSelected = useCallback(() => {
    if (!editable || sel.size === 0) return;
    deleteObjects(doc, [...sel.ids]);
  }, [doc, sel, editable]);

  const handleColor = useCallback(
    (c: StickyColor) => {
      if (!editable) return;
      for (const id of sel.ids) {
        const o = objects.find((x) => x.id === id);
        if (o?.type === 'sticky') setStickyColor(doc, id, c);
      }
    },
    [doc, sel, objects, editable],
  );

  // Selection bounding box (world units) for the overlay and the bar position.
  const selectedObjects = objects.filter((o) => sel.has(o.id));
  const box = unionRects(selectedObjects.map(objectBounds));
  const showsHandles =
    selectedObjects.length > 0 &&
    selectedObjects.every((o) => getObjectType(o.type)?.resizable !== false);
  const showOverlay = sel.size > 0 && sel.editingId === null;
  const showBar = sel.size > 0 && sel.editingId === null && !gesture.active;

  // Render objects in a stable order (by id) so that changing an object's z
  // (bringToFront during a drag) only changes its z-index and never reorders
  // the DOM. Reordering a DOM node mid-gesture would reset the pointer.
  const orderedObjects = [...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let barPos: { left: number; top: number } | null = null;
  if (box && showBar) {
    const topCenter = worldToScreen(cam.camera, { x: box.x + box.width / 2, y: box.y });
    barPos = { left: topCenter.x, top: topCenter.y - 8 };
  }

  const singleSticky =
    sel.size === 1
      ? (objects.find((o) => sel.has(o.id)) as StickySnapshot | undefined) ?? null
      : null;

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
        onMarqueeStart={(e) => {
          marquee.begin(e);
          return true;
        }}
      >
        {orderedObjects.map((o) => {
          const spec = getObjectType(o.type);
          if (!spec) return null;
          const Component = spec.Component;
          return (
            <Component
              key={o.id}
              obj={o}
              doc={doc}
              zoom={cam.camera.zoom}
              selected={sel.has(o.id)}
              editing={o.id === sel.editingId}
              onPointerDown={onObjectPointerDown}
              onStartEdit={(id) => sel.startEdit(id)}
              onEndEdit={(next) => {
                sel.endEdit();
                if (next === 'unselected') sel.clear();
              }}
            />
          );
        })}
        {marquee.rect && <MarqueeRect rect={marquee.rect} />}
        {box && showOverlay && (
          <SelectionOverlay
            box={box}
            zoom={cam.camera.zoom}
            showHandles={showsHandles}
            canEdit={editable}
            onHandlePointerDown={gesture.onHandlePointerDown}
          />
        )}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtCenter} disabled={!editable} />
      {showBar && barPos && (
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
            count={sel.size}
            sticky={singleSticky && singleSticky.type === 'sticky' ? singleSticky : null}
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
