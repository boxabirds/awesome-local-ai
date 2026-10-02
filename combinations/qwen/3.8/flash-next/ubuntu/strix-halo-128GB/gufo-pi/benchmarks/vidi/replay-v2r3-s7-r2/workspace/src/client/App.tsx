import React, { useEffect, useCallback, useState } from 'react';
import type * as Y from 'yjs';
import { useCamera } from './canvas/useCamera';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import type { Size } from './canvas/camera';
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useBoardKeys } from './board/useBoardKeys';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { canEdit } from './sync/connectBoard';
import { Toolbar } from './board/Toolbar';
import { getObjectType } from './objects/registry';
import type { ObjectProps } from './objects/registry';
import { createSticky, deleteObjects, snapshot } from '../shared/board-model';
import type { ObjectSnapshot } from '../shared/board-model';
import { registerTestHooks } from './canvas/testHooks';
import { ConnectionStatus } from './sync/ConnectionStatus';

/** Props every object component gets, except what is per object. */
type SharedObjectProps = Omit<ObjectProps, 'obj' | 'selected' | 'soleSelected' | 'editing' | 'transforming'>;

/**
 * BoardUI: the board UI of stories 1–5 plus multi-selection (story 7).
 * Requires a boardId (existence already checked).
 */
export function BoardUI({ boardId }: { boardId: string }) {
  const [viewport, setViewport] = useState<Size>({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    gestureZoom,
    zoomStep,
    reset,
    setCamera,
  } = useCamera(viewport);

  const { doc, objects, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(objects);
  const selectionRef = React.useRef(selection);
  selectionRef.current = selection;

  // A board that failed to load is read-only: creating, moving, resizing,
  // deleting and text editing are all disabled until it loads. Selecting still
  // works, because that changes nothing.
  const editable = canEdit(connectionState);

  const marquee = useMarquee(camera, objects, useCallback(
    (ids: string[]) => selection.setMany(ids, true),
    [selection],
  ));

  const gesture = useTransformGesture({
    doc,
    selection,
    snapshot: objects,
    camera,
    canEdit: editable,
  });

  useBoardKeys({ doc, selection, snapshot: objects, canEdit: editable });

  // Track viewport size
  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Register test hooks (no-op outside the test build mode)
  useEffect(() => {
    registerTestHooks({
      setCamera,
      getBoard: () => snapshot(doc),
      addSticky: (at, text, color) => {
        const id = createSticky(doc, at, (color as never) ?? undefined);
        if (id && text) {
          const m = doc.getMap('objects').get(id) as Y.Map<unknown>;
          const t = m.get('text') as Y.Text;
          t.insert(0, text);
        }
        return id;
      },
      getSelectedIds: () => [...selectionRef.current.ids],
      getEditingId: () => selectionRef.current.editingId,
    });
  }, [setCamera, doc]);

  // Expose connection state for e2e tests
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      (window as any).__vidi6 = (window as any).__vidi6 || {};
      (window as any).__vidi6.connectionState = connectionState;
    }
  }, [connectionState]);

  // Zoom shortcuts. The selection commands of story 7 live in useBoardKeys.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          zoomStep('in');
        } else if (e.key === '-') {
          e.preventDefault();
          zoomStep('out');
        } else if (e.key === '0') {
          e.preventDefault();
          reset();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomStep, reset]);

  const handleGestureZoom = useCallback(
    (scale: number, point: { x: number; y: number }) => {
      gestureZoom(scale, point);
    },
    [gestureZoom],
  );

  // A new note lands centred on the given screen point and opens for typing.
  const createAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => {
      if (!editable) return;
      const world = screenToWorld(camera, point);
      const id = createSticky(doc, world);
      if (id) selection.startEdit(id);
    },
    [camera, doc, selection, editable],
  );

  const handleToolbarCreate = useCallback(() => {
    createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreenPoint, viewport]);

  const handleEmptyDblClick = useCallback(
    (point: { x: number; y: number }) => {
      createAtScreenPoint(point);
    },
    [createAtScreenPoint],
  );

  const handleEmptyClick = useCallback(() => {
    selection.clear();
  }, [selection]);

  const deleteSelection = useCallback(() => {
    if (!editable) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, editable, selection]);

  const shared: SharedObjectProps = {
    doc,
    zoom: camera.zoom,
    editable,
    onObjectPointerDown: gesture.onObjectPointerDown,
    onStartEdit: selection.startEdit,
    onEndEdit: selection.endEdit,
  };

  const renderObject = (obj: ObjectSnapshot) => {
    const spec = getObjectType(obj.type);
    // A type this build does not know is skipped rather than breaking the board.
    if (!spec) return null;
    const Component = spec.Component;
    const selected = selection.ids.has(obj.id);
    return (
      <Component
        key={obj.id}
        obj={obj}
        {...shared}
        selected={selected}
        soleSelected={selected && selection.ids.size === 1}
        editing={selection.editingId === obj.id}
        transforming={gesture.activeIds.has(obj.id)}
      />
    );
  };

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={camera}
        onBeginPan={beginPan}
        onPanMove={panMove}
        onEndPan={endPan}
        onWheel={wheel}
        onGestureZoom={handleGestureZoom}
        onEmptyClick={handleEmptyClick}
        onEmptyDblClick={handleEmptyDblClick}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
        overlay={
          <>
            <SelectionOverlay
              ids={selection.ids}
              snapshot={objects}
              camera={camera}
              editable={editable}
              frozen={gesture.frozen}
              onHandlePointerDown={gesture.onHandlePointerDown}
              onEmptyDblClick={handleEmptyDblClick}
            />
            <SelectionBar
              ids={selection.ids}
              snapshot={objects}
              camera={camera}
              editable={editable}
              onDelete={deleteSelection}
            />
            <MarqueeRect rect={marquee.rect} camera={camera} />
          </>
        }
      >
        {objects.map(renderObject)}
      </BoardViewport>
      <Toolbar onCreateSticky={handleToolbarCreate} disabled={!editable} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}

/** Backward-compatible export for tests that import App */
export { BoardUI as App };
