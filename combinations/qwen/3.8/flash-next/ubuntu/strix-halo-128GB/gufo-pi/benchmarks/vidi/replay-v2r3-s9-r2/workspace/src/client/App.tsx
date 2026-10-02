import React, { useEffect, useCallback, useState, useRef } from 'react';
import type * as Y from 'yjs';
import { useCamera } from './canvas/useCamera';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import type { Size } from './canvas/camera';
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTool } from './board/useTool';
import { canEdit } from './sync/connectBoard';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { TextObject, getSharedMeasurer } from './objects/TextObject';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { createUndo, type UndoController } from './board/undo';
import { useUndo } from './board/useUndo';
import { writeTextBox } from './objects/useTextBoxSync';
import { getClientId } from './sync/clientId';
import { createText, setTextWidthFixed } from '../shared/objects/text';
import { createSticky, deleteObjects, moveObjects, snapshot, snapshotObjects, LOCAL_ORIGIN } from '../shared/board-model';
import { registerTestHooks } from './canvas/testHooks';
import { ConnectionStatus } from './sync/ConnectionStatus';

/**
 * BoardUI: the board UI with multi-selection support (stories 1-7).
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
  const editable = canEdit(connectionState);
  const tool = useTool(editable);
  const measurer = getSharedMeasurer();

  // One undo controller per board doc, destroyed on board change/unmount (session-only history)
  const undoRef = useRef<UndoController | null>(null);
  if (undoRef.current === null) {
    undoRef.current = createUndo(doc);
  }
  const undoController = undoRef.current;
  useEffect(() => {
    return () => {
      undoController.destroy();
    };
  }, [undoController]);
  const undoState = useUndo(undoController, editable);

  const marquee = useMarquee(camera, objects, (ids) => selection.setMany(ids, true));

  // The latest snapshot, for gesture callbacks that need the current position.
  const objectsRef = useRef(objects);
  objectsRef.current = objects;

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: undoController.boundary,
    onGestureEnd: undoController.boundary,
    // Story 9: a text object dragged sideways gets a fixed width, then the
    // height follows the content that fits in it.
    onHorizontalResize: (id, width, x) => {
      const obj = objectsRef.current.find((o) => o.id === id);
      if (!obj) return;
      setTextWidthFixed(doc, id, width);
      moveObjects(doc, new Map([[id, { x, y: obj.y }]]));
      writeTextBox(doc, id, measurer);
    },
    remeasure: (ids) => {
      for (const id of ids) writeTextBox(doc, id, measurer);
    },
  });

  // Track viewport size
  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Register test hooks (no-op outside the test build mode)
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    registerTestHooks({
      setCamera,
      getBoard: () => snapshot(doc),
      addSticky: (at, text, color) => {
        undoController.boundary();
        const id = createSticky(doc, at, (color as any) ?? undefined);
        if (id && text) {
          const m = doc.getMap('objects').get(id) as Y.Map<unknown>;
          const t = m.get('text') as Y.Text;
          doc.transact(() => t.insert(0, text), LOCAL_ORIGIN);
        }
        undoController.boundary();
        return id;
      },
      getSelectedIds: () => [...selectionRef.current.ids],
      getObjects: () => snapshotObjects(doc),
    });
  }, [setCamera, doc, undoController]);

  // Expose connection state for e2e tests
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      (window as any).__vidi6 = (window as any).__vidi6 || {};
      (window as any).__vidi6.connectionState = connectionState;
    }
  }, [connectionState]);

  // Zoom keyboard shortcuts (Ctrl/Cmd + / - / 0)
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

  // Enter edits the selected note (single sticky only)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selection.editingId || selection.ids.size !== 1 || isTextEntry(e.target)) return;
      if (!editable) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        const [id] = selection.ids;
        selection.startEdit(id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, editable]);

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
      undoController.boundary();
      const id = createSticky(doc, world);
      undoController.boundary();
      if (id) selection.startEdit(id);
    },
    [camera, doc, selection, editable, undoController],
  );

  const handleToolbarCreate = useCallback(() => {
    createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreenPoint, viewport]);

  // Board keyboard commands, including the story 9 tool keys V / T / N.
  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    undoController,
    tool,
    onCreateSticky: handleToolbarCreate,
  });

  // Story 9: the Text tool places an empty text at the clicked point — its
  // top-left corner, never centred — selects it and opens it for typing, then
  // hands the tool back to Select so the next click selects or moves things.
  const handleTextToolClick = useCallback(
    (point: { x: number; y: number }) => {
      if (!editable) return;
      undoController.boundary();
      const id = createText(doc, point, getClientId());
      if (id) writeTextBox(doc, id, measurer);
      undoController.boundary();
      if (!id) return;
      tool.setTool('select');
      selection.startEdit(id);
    },
    [doc, editable, measurer, selection, tool, undoController],
  );

  const handleEmptyDblClick = useCallback(
    (point: { x: number; y: number }) => {
      createAtScreenPoint(point);
    },
    [createAtScreenPoint],
  );

  const handleEmptyClick = useCallback(() => {
    selection.clear();
  }, [selection]);

  const handleDeleteSelection = useCallback(() => {
    if (!editable) return;
    undoController.boundary();
    deleteObjects(doc, [...selection.ids]);
    undoController.boundary();
    selection.clear();
  }, [doc, selection, editable, undoController]);

  const handleMarqueeBegin = useCallback((p: { x: number; y: number }) => {
    marquee.begin(p);
  }, [marquee]);

  const handleMarqueeMove = useCallback((p: { x: number; y: number }) => {
    marquee.move(p);
  }, [marquee]);

  const handleMarqueeEnd = useCallback(() => {
    marquee.end();
  }, [marquee]);

  const handleMarqueeCancel = useCallback(() => {
    marquee.cancel();
  }, [marquee]);

  const handleObjectPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      gesture.onObjectPointerDown(e, id);
    },
    [gesture],
  );

  const handleHandlePointerDown = useCallback(
    (e: React.PointerEvent, handle: any) => {
      gesture.onHandlePointerDown(e, handle);
    },
    [gesture],
  );

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
        onMarqueeBegin={handleMarqueeBegin}
        onMarqueeMove={handleMarqueeMove}
        onMarqueeEnd={handleMarqueeEnd}
        onMarqueeCancel={handleMarqueeCancel}
        textToolActive={tool.tool === 'text'}
        onTextToolClick={handleTextToolClick}
      >
        {objects.map((obj) => {
          const shared = {
            doc,
            zoom: camera.zoom,
            selected: selection.ids.has(obj.id),
            editing: obj.id === selection.editingId,
            dragging: gesture.draggingIds.has(obj.id),
            onSelect: (id: string) => {
              if (selection.ids.has(id) && selection.ids.size === 1) return;
              selection.click(id);
            },
            onStartEdit: selection.startEdit,
            onEndEdit: (next: 'selected' | 'unselected') => {
              if (next === 'unselected') selection.clear();
              else selection.endEdit();
            },
            onObjectPointerDown: handleObjectPointerDown,
            editable,
            undoController,
          };
          return obj.type === 'text' ? (
            <TextObject key={obj.id} note={obj} measure={measurer} {...shared} />
          ) : (
            <StickyNote key={obj.id} note={obj} {...shared} />
          );
        })}
      </BoardViewport>
      <MarqueeRect rect={marquee.rect} camera={camera} />
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={camera}
        onHandlePointerDown={handleHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={objects}
        onDelete={handleDeleteSelection}
      />
      <Toolbar
        onCreateSticky={handleToolbarCreate}
        disabled={!editable}
        undo={undoState}
        tool={tool.tool}
        onSelectTool={tool.setTool}
      />
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

/** True when a key press belongs to a text field rather than to the board. */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Backward-compatible export for tests that import App */
export { BoardUI as App };
