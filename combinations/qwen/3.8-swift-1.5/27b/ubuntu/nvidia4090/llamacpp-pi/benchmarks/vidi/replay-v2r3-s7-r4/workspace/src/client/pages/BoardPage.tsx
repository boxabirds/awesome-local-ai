import { useCallback, useEffect, useRef, useState } from 'react';
import { checkBoard } from '../api';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useTransformGesture } from '../board/useTransformGesture';
import { useMarquee } from '../board/useMarquee';
import { useBoardKeys } from '../board/useBoardKeys';
import { Toolbar } from '../board/Toolbar';
import { getObjectType } from '../objects/registry';
import { SelectionOverlay } from '../objects/SelectionOverlay';
import { SelectionBar } from '../objects/SelectionBar';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { useCamera } from '../canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent, screenToWorld } from '../canvas/camera';
import type { Size, Point } from '../canvas/camera';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../sync/connectBoard';
import {
  createSticky,
  deleteObjects,
  setStickyColor,
  moveObjects,
  allObjectIds,
  type ObjectSnapshot,
} from '../../shared/board-model';
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
 * The board (stories 1–7 UI), extracted from App.tsx. Mounted by BoardPage
 * only after the existence check succeeds.
 *
 * Story 7: objects render from the shared snapshot via the object type
 * registry; selection/move/resize/delete are the generic hooks
 * (useSelection, useTransformGesture, useMarquee, useBoardKeys).
 */
function Board({ boardId }: { boardId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const cam = useCamera(viewport);

  const { doc, objects, connectionState } = useBoardDoc(boardId);
  const sel = useSelection(objects);

  // Stable views of the latest camera/selection/snapshot for the gesture hooks.
  const objectsRef = useRef<readonly ObjectSnapshot[]>(objects);
  objectsRef.current = objects;
  const cameraRef = useRef(cam.camera);
  cameraRef.current = cam.camera;
  const selRef = useRef(sel);
  selRef.current = sel;

  const toWorld = useCallback(
    (clientX: number, clientY: number) =>
      screenToWorld(cameraRef.current, { x: clientX, y: clientY }),
    [],
  );
  const getSnapshot = useCallback(() => objectsRef.current, []);

  const gesture = useTransformGesture({
    doc,
    toWorld,
    getSnapshot,
    getSelection: () => selRef.current.ids,
    isEditing: (id) => selRef.current.editingId === id,
    onSelect: (id) => selRef.current.click(id),
    canEdit: () => editableRef.current,
  });

  const marquee = useMarquee({
    toWorld,
    toScreen: (p) => ({
      x: (p.x - cameraRef.current.x) * cameraRef.current.zoom,
      y: (p.y - cameraRef.current.y) * cameraRef.current.zoom,
    }),
    zoom: () => cameraRef.current.zoom,
    getSnapshot,
    onSelect: (ids, additive) => selRef.current.setMany(ids, additive),
  });

  useEffect(() => {
    // `select`/`getSelection` are test seams so e2e can establish a
    // multi-selection without a marquee drag (which leaves headless Chromium
    // in a state that spuriously cancels the following pointer drag).
    (window as any).__VIDI_DEBUG__ = {
      doc,
      select: (ids: string[]) => selRef.current.setMany(ids, false),
      getSelection: () => [...selRef.current.ids],
    };
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
  const editableRef = useRef(editable);
  editableRef.current = editable;

  const createAtScreen = useCallback(
    (screenPoint: Point) => {
      if (!editableRef.current) return;
      const world = screenToWorld(cameraRef.current, screenPoint);
      const id = createSticky(doc, world);
      if (id) selRef.current.startEdit(id);
    },
    [doc],
  );

  const createAtCenter = useCallback(() => {
    if (!editableRef.current) return;
    const center: Point = { x: viewport.width / 2, y: viewport.height / 2 };
    createAtScreen(center);
  }, [createAtScreen, viewport.width, viewport.height]);

  const handleClearSelection = useCallback(() => {
    selRef.current.clear();
  }, []);

  const handleDeleteSelection = useCallback(() => {
    if (!editableRef.current) return;
    const ids = [...selRef.current.ids];
    if (ids.length === 0) return;
    deleteObjects(doc, ids);
    selRef.current.clear();
  }, [doc]);

  const handleColor = useCallback(
    (id: string, color: string) => {
      if (!editableRef.current) return;
      setStickyColor(doc, id, color as StickyColor);
    },
    [doc],
  );

  const handleNudge = useCallback(
    (dx: number, dy: number) => {
      if (!editableRef.current) return;
      const positions = new Map<string, Point>();
      for (const o of objectsRef.current) {
        if (selRef.current.ids.has(o.id)) positions.set(o.id, { x: o.x + dx, y: o.y + dy });
      }
      if (positions.size > 0) moveObjects(doc, positions);
    },
    [doc],
  );

  const handleStartEditingSelection = useCallback(() => {
    const ids = [...selRef.current.ids];
    if (ids.length !== 1) return;
    const obj = objectsRef.current.find((o) => o.id === ids[0]);
    if (obj && getObjectType(obj.type)?.editableText) selRef.current.startEdit(ids[0]);
  }, []);

  // Board keyboard (story 7): Ctrl+A, Escape, arrows, Delete/Backspace, Enter.
  useBoardKeys({
    selectAll: () => selRef.current.setMany(allObjectIds(objectsRef.current), false),
    clear: () => selRef.current.clear(),
    deleteSelection: handleDeleteSelection,
    nudge: handleNudge,
    startEditingSelection: handleStartEditingSelection,
    cancelGesture: gesture.cancelGesture,
    isEditing: () => selRef.current.editingId !== null,
    isGestureActive: gesture.isGestureActive,
  });

  // Render objects in a stable order (by id) so that changing an object's z
  // (e.g. bringObjectsToFront during a drag) only changes its z-index and
  // never reorders the DOM. Visual stacking is handled by each object's
  // z-index.
  const orderedObjects = [...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const selectedObjects = objects.filter((o) => sel.ids.has(o.id));
  const showSelectionBar =
    selectedObjects.length > 0 && sel.editingId === null && !gesture.active;

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
        interceptPointerDown={(e) => {
          if (e.shiftKey) {
            marquee.begin(e);
            return true;
          }
          return false;
        }}
        marqueeScreenRect={marquee.screenRect}
      >
        {orderedObjects.map((obj) => {
          const spec = getObjectType(obj.type);
          if (!spec) return null; // unknown types stay invisible (sel.all_types)
          const C = spec.Component;
          return (
            <C
              key={obj.id}
              obj={obj}
              doc={doc}
              zoom={cam.camera.zoom}
              selected={sel.ids.has(obj.id)}
              editing={sel.editingId === obj.id}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onStartEdit={sel.startEdit}
              onEndEdit={sel.endEdit}
            />
          );
        })}
      </BoardViewport>
      <SelectionOverlay
        objects={selectedObjects}
        toScreen={(p) => ({
          x: (p.x - cam.camera.x) * cam.camera.zoom,
          y: (p.y - cam.camera.y) * cam.camera.zoom,
        })}
        zoom={cam.camera.zoom}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      {showSelectionBar && (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 16,
            transform: 'translateX(-50%)',
            zIndex: 30,
          }}
        >
          <SelectionBar objects={selectedObjects} onDelete={handleDeleteSelection} onColor={handleColor} />
        </div>
      )}
      <Toolbar onCreateSticky={createAtCenter} disabled={!editable} />
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
