import { useCallback, useEffect, useRef, useState } from 'react';
import { checkBoard } from '../api';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useTransformGesture } from '../board/useTransformGesture';
import { useBoardKeys } from '../board/useBoardKeys';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { Toolbar } from '../board/Toolbar';
import { getObjectType } from '../objects/registry';
import { NoteToolbar } from '../objects/NoteToolbar';
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
  setStickyColor,
  deleteObjects,
  objectsInRect,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
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
 * The board (stories 1–4 UI), extracted from App.tsx. Mounted by BoardPage
 * only after the existence check succeeds.
 */
function Board({ boardId }: { boardId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const cam = useCamera(viewport);

  const { doc, objects, connectionState } = useBoardDoc(boardId);
  const sel = useSelection(objects);
  const [gestureActive, setGestureActive] = useState(false);

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

  const editable = canEdit(connectionState);

  const gesture = useTransformGesture({
    doc,
    camera: cam.camera,
    objects,
    canEdit: editable,
    selection: sel,
    onGestureStart: () => setGestureActive(true),
    onGestureEnd: () => setGestureActive(false),
  });

  useBoardKeys({ objects, selection: sel, doc, canEdit: editable });

  // Sticky note creation (gated by canEdit)
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

  const handleMarqueeSelect = useCallback(
    (rect: { x: number; y: number; width: number; height: number }, additive: boolean) => {
      sel.setMany(objectsInRect(objects, rect), additive);
    },
    [objects, sel],
  );

  const handleDeleteSelection = useCallback(() => {
    if (!editable) return;
    if (sel.ids.size === 0) return;
    deleteObjects(doc, [...sel.ids]);
    sel.clear();
  }, [doc, sel, editable]);

  const handleColor = useCallback(
    (c: StickyColor) => {
      if (!editable) return;
      if (sel.ids.size === 1) {
        const [id] = sel.ids;
        setStickyColor(doc, id, c);
      }
    },
    [doc, sel, editable],
  );

  // Render objects in a stable order (by id) so that changing an object's z
  // (bringToFront during a drag) only changes its z-index and never reorders
  // the DOM. Reordering a DOM node mid-drag would reset pointer capture.
  const orderedObjects = [...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Single-sticky NoteToolbar (story 2) — hidden while editing or gesturing.
  const selectedSticky =
    sel.ids.size === 1 && sel.editingId === null && !gestureActive
      ? objects.find((o) => o.id === [...sel.ids][0] && o.type === 'sticky')
      : undefined;

  let noteToolbarPos: { left: number; top: number } | null = null;
  if (selectedSticky) {
    const b = objectBounds(selectedSticky as ObjectSnapshot);
    const tl = worldToScreen(cam.camera, { x: b.x, y: b.y });
    noteToolbarPos = {
      left: tl.x + (b.width * cam.camera.zoom) / 2,
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
        onMarqueeSelect={handleMarqueeSelect}
      >
        {orderedObjects.map((obj) => {
          const spec = getObjectType(obj.type);
          if (!spec) return null;
          const Component = spec.Component;
          return (
            <Component
              key={obj.id}
              obj={obj}
              doc={doc}
              selected={sel.ids.has(obj.id)}
              editing={sel.editingId === obj.id}
              onPointerDown={(e: PointerEvent) => gesture.onObjectPointerDown(e, obj.id)}
              onStartEdit={() => sel.startEdit(obj.id)}
              onEndEdit={(next) => (next === 'unselected' ? sel.clear() : sel.endEdit())}
            />
          );
        })}
      </BoardViewport>
      <SelectionOverlay
        objects={objects}
        selectedIds={sel.ids}
        editingId={sel.editingId}
        camera={cam.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <Toolbar onCreateSticky={createAtCenter} disabled={!editable} />
      {selectedSticky && noteToolbarPos && (
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
            color={(selectedSticky as { color?: StickyColor }).color ?? 'yellow'}
            onColor={handleColor}
            onDelete={handleDeleteSelection}
          />
        </div>
      )}
      <SelectionBar count={sel.ids.size} onDeleteSelection={handleDeleteSelection} />
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
