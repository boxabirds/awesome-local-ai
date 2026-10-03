/**
 * Board page (story 5, share.pages).
 *
 * - malformed id → Board not found immediately (no request sent)
 * - valid id → "Opening board…" while `checkBoard` runs
 *   - exists → the stories 1–4 board (with the Share panel)
 *   - not_found → Board not found page
 *   - unreachable → "Couldn't reach vidi6. Retrying…" with exponential
 *     backoff (BOARD_CHECK_RETRY_BASE_MS doubling, capped at
 *     RECONNECT_MAX_BACKOFF_MS); the board opens when the service is
 *     reachable again, without a reload
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { canZoomIn, canZoomOut, zoomPercent, screenToWorld } from '../canvas/camera';
import type { Size } from '../canvas/camera';
import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { useCamera } from '../canvas/useCamera';
import { ZoomControls } from '../canvas/ZoomControls';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useTransformGesture } from '../board/useTransformGesture';
import { useBoardKeys } from '../board/useBoardKeys';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { Toolbar } from '../board/Toolbar';
import { getObjectType } from '../objects/registry';
import {
  createSticky,
  deleteObjects,
  objectBounds,
  setStickyColor,
} from '../../shared/board-model';
import type { Rect } from '../../shared/geometry';
import type { StickySnapshot } from '../../shared/board-model';
import type { StickyColor } from '../../shared/config';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

const INITIAL_SIZE: Size = { width: 0, height: 0 };

export function BoardPage(props: { id: string }): JSX.Element {
  const valid = isValidBoardId(props.id);
  const [state, setState] = useState<BoardPageState>(
    valid ? { kind: 'checking', boardId: props.id } : { kind: 'not_found' },
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    let timer: number | undefined;
    let attempt = 0;
    const doCheck = async () => {
      attempt += 1;
      const currentAttempt = attempt;
      const result = await checkBoard(props.id);
      if (cancelled) return;
      const next = nextBoardPageState(stateRef.current, result, currentAttempt);
      setState(next);
      if (next.kind === 'unreachable') {
        timer = window.setTimeout(doCheck, next.nextRetryMs);
      }
    };
    void doCheck();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [props.id, valid]);

  switch (state.kind) {
    case 'checking':
      return (
        <div
          data-testid="board-checking"
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'system-ui, sans-serif',
            color: '#555',
          }}
        >
          Opening board…
        </div>
      );
    case 'not_found':
      return <NotFoundPage />;
    case 'unreachable':
      return (
        <div
          data-testid="board-unreachable"
          role="status"
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'system-ui, sans-serif',
            color: '#555',
          }}
        >
          Couldn't reach vidi6. Retrying…
        </div>
      );
    case 'ready':
      return <BoardView boardId={state.boardId} />;
  }
}

/**
 * The stories 1–4 board UI, mounted only once the board's existence has
 * been confirmed. Owns the camera, the Y.Doc and the network connection.
 * Exported so component tests can render the board directly (story 5: the
 * route `/` now renders the home page, not the board).
 */
export function BoardView({
  boardId,
  deps,
}: {
  boardId: string;
  /** Connection dependency injection (test builds: fake provider). */
  deps?: import('../sync/connectBoard').ConnectBoardDeps;
}): JSX.Element {
  const shellRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(INITIAL_SIZE);

  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const controls = useCamera(size);
  const { doc, objects, connectionState } = useBoardDoc(boardId, deps);
  const selection = useSelection(objects);
  const isLoadFailed = connectionState === 'load-failed';
  const canEdit = !isLoadFailed;
  const gesture = useTransformGesture({
    doc,
    camera: controls.camera,
    objects,
    selection,
    canEdit,
    onGestureStart: () => window.__vidi6?.gestureLog?.push('start'),
    onGestureEnd: () => window.__vidi6?.gestureLog?.push('end'),
  });

  // Board keyboard commands (story 7: select all, nudge, delete, …).
  useBoardKeys({ doc, objects, selection, canEdit, startEdit: selection.startEdit });

  // Marquee (story 7): Shift+drag on empty space selects by containment.
  const marquee = useMarquee(controls.camera, objects, (ids) => selection.setMany(ids, true));

  // Publish the mapped connection state to the test hook (test builds only).
  useEffect(() => {
    window.__vidi6?.setConnectionState(connectionState);
  }, [connectionState]);

  // Create a sticky note at a screen point (disabled when load failed)
  const handleCreateAtScreenPoint = useCallback(
    (screenPoint: { x: number; y: number }) => {
      if (isLoadFailed) return;
      const worldPoint = screenToWorld(controls.camera, screenPoint);
      const id = createSticky(doc, worldPoint);
      selection.startEdit(id);
    },
    [doc, controls.camera, selection, isLoadFailed],
  );

  // Create from toolbar button (centre of viewport)
  const handleCreateSticky = useCallback(() => {
    if (isLoadFailed) return;
    const centre = { x: size.width / 2, y: size.height / 2 };
    handleCreateAtScreenPoint(centre);
  }, [size, handleCreateAtScreenPoint, isLoadFailed]);

  // Double-click on empty board space
  const handleDblClickEmpty = useCallback(
    (point: { x: number; y: number }) => {
      if (isLoadFailed) return;
      handleCreateAtScreenPoint(point);
    },
    [handleCreateAtScreenPoint, isLoadFailed],
  );

  // Click on empty board space → clear selection
  const handleClickEmpty = useCallback(() => {
    selection.clear();
  }, [selection]);

  // Delete the current selection (bar button / Delete key).
  const handleDeleteSelection = useCallback(() => {
    if (isLoadFailed || selection.ids.size === 0) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection, isLoadFailed]);

  // Recolour the single selected sticky (story 2 toolbar, now in the bar).
  const handleColor = useCallback(
    (c: StickyColor) => {
      if (selection.ids.size !== 1) return;
      const [id] = [...selection.ids];
      setStickyColor(doc, id, c);
    },
    [doc, selection],
  );

  const selectedObjects = objects.filter((o) => selection.ids.has(o.id));
  const resizable =
    selectedObjects.length > 0 &&
    selectedObjects.every((o) => getObjectType(o.type)?.resizable === true);
  const singleSticky =
    selection.ids.size === 1
      ? selectedObjects.find((o): o is StickySnapshot => o.type === 'sticky')
      : undefined;

  // Screen-space anchor (top-centre) of the single selected object, for the
  // note toolbar in the screen-space selection bar.
  const singleAnchor = useMemo(() => {
    if (!singleSticky) return undefined;
    const b = objectBounds(singleSticky);
    return {
      x: (b.x + b.width / 2 - controls.camera.x) * controls.camera.zoom,
      y: (b.y - controls.camera.y) * controls.camera.zoom,
    };
  }, [singleSticky, controls.camera]);

  return (
    <div ref={shellRef} style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <BoardViewport
        controls={controls}
        onDblClickEmpty={handleDblClickEmpty}
        onClickEmpty={handleClickEmpty}
        marquee={canEdit ? marquee : undefined}
      >
        {objects.map((obj) => {
          const spec = getObjectType(obj.type);
          if (!spec) return null;
          const { Component } = spec;
          return (
            <Component
              key={obj.id}
              obj={obj}
              doc={doc}
              zoom={controls.camera.zoom}
              selected={selection.ids.has(obj.id)}
              editing={selection.editingId === obj.id}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
            />
          );
        })}
        <SelectionOverlay
          objects={objects}
          ids={selection.ids}
          zoom={controls.camera.zoom}
          resizable={resizable}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
        <MarqueeRect rect={marquee.rect} camera={controls.camera} />
      </BoardViewport>
      <SelectionBar
        count={selection.ids.size}
        singleColor={singleSticky?.color}
        anchor={singleAnchor}
        onColor={handleColor}
        onDelete={handleDeleteSelection}
      />
      <Toolbar onCreateSticky={handleCreateSticky} />
      <ZoomControls
        zoomPercent={zoomPercent(controls.camera)}
        canZoomIn={canZoomIn(controls.camera)}
        canZoomOut={canZoomOut(controls.camera)}
        onZoomIn={() => controls.zoomStep('in')}
        onZoomOut={() => controls.zoomStep('out')}
        onReset={controls.reset}
      />
      <NavigationHint visible={!controls.hasNavigated} />
      <ConnectionStatus state={connectionState} />
      <SharePanel boardId={boardId} />
    </div>
  );
}
