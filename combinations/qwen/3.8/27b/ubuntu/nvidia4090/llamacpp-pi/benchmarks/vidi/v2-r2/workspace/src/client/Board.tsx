/**
 * Board (story 1-7): canvas, objects (through the object registry),
 * multi-selection, toolbar, zoom, connection status and navigation hint
 * for one board. The board id is given by the page (story 5: `/b/:id`
 * routes carry it).
 *
 * Story 7 (sel.*): selection / transform-gesture / marquee / keyboard are
 * wired here; every object type renders through the registry, so future
 * object types get selection, move, resize and delete for free.
 * Selection and the text-editing flag are client state — they are never
 * written to the Y.Doc.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { CameraContext, useCamera } from './canvas/useCamera';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Point,
} from './canvas/camera';
import { installVidi6TestHooks, updateVidi6ConnectionState } from './canvas/testHooks';
import { ConnectionStatus } from './sync/ConnectionStatus';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  renderOrder,
  setStickyColor,
  type StickySnapshot,
} from '../shared/board-model';
import { STICKY_SIZE_WORLD, type StickyColor } from '../shared/config';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { createUndo } from './board/undo';
import { useUndo } from './board/useUndo';
import { useTransformGesture } from './board/useTransformGesture';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useBoardKeys } from './board/useBoardKeys';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { Toolbar } from './board/Toolbar';
import { NoteToolbar } from './objects/NoteToolbar';
import { getObjectType } from './objects/registry';
import { type ConnectionState } from './sync/connectBoard';

/**
 * The board is editable in every connection state except load_failed
 * (persist.client_status): while the board couldn't be loaded, edits would
 * be lost, so create/drag/edit/colour/delete are no-ops and the Sticky note
 * button is disabled. Exported for the component tests (TC-23) and reused by
 * the board to gate its editing handlers.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/** Board background colour (the dot grid is drawn on top). */
const BOARD_BACKGROUND = '#f8f8f6';
/** Origin marker (small crosshair at world 0,0): a stable e2e pixel target. */
const ORIGIN_MARKER_HALF_PX = 6;
const ORIGIN_MARKER_COLOR = '#8f8f86';

/**
 * Small crosshair at the board's starting point (world 0,0), rendered in
 * all builds so e2e tests have a stable pixel target.
 */
function OriginMarker(): JSX.Element {
  return (
    <div
      data-testid="origin-marker"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: -ORIGIN_MARKER_HALF_PX,
        top: -ORIGIN_MARKER_HALF_PX,
        width: ORIGIN_MARKER_HALF_PX * 2,
        height: ORIGIN_MARKER_HALF_PX * 2,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: ORIGIN_MARKER_HALF_PX - 0.5,
          width: '100%',
          height: 1,
          background: ORIGIN_MARKER_COLOR,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: ORIGIN_MARKER_HALF_PX - 0.5,
          top: 0,
          width: 1,
          height: '100%',
          background: ORIGIN_MARKER_COLOR,
        }}
      />
    </div>
  );
}

interface BoardProps {
  boardId: string;
  /** Test-only: report the backing Y.Doc once it exists (component tests). */
  onDocReady?: (doc: Y.Doc) => void;
}

export function Board({ boardId, onDocReady }: BoardProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth || 1,
    height: window.innerHeight || 1,
  }));

  // Viewport size from a ResizeObserver (window resize never moves content:
  // the camera is anchored to the top-left and carries no size).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) {
      return;
    }
    const update = (): void => {
      setViewport((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      );
    };
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
    // Fallback for environments without ResizeObserver (e.g. jsdom).
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const cameraController = useCamera(viewport);
  const { doc, objects, connectionState, dropSocket, resumeSocket } = useBoardDoc(boardId);
  const editable = canEdit(connectionState);

  // --- undo / redo (story 8) -------------------------------------------------
  // One controller per board doc, created with the doc and destroyed on
  // board change / unmount: history is session-only (undo.session_only) and
  // holds only this tab's LOCAL_ORIGIN steps (undo.own).
  const undo = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => undo.destroy(), [undo]);
  const undoActions = useUndo(undo, editable);

  // Test-only: expose the doc for the component tests.
  if (onDocReady !== undefined) {
    onDocReady(doc);
  }

  // --- selection (story 7) --------------------------------------------------
  const selection = useSelection(objects);

  // --- text editing ----------------------------------------------------------
  // The editor reports 'unselected' when a press lands outside the note
  // (clearing the whole selection) and 'selected' for Escape (keeping it).
  const handleEndEdit = useCallback(
    (next: 'selected' | 'unselected'): void => {
      if (next === 'unselected') {
        selection.clear();
      } else {
        selection.endEdit();
      }
    },
    [selection],
  );

  const handleEdit = useCallback(
    (id: string): void => {
      if (!editable) {
        return; // load_failed: editing is locked out
      }
      selection.click(id);
      selection.startEdit(id);
    },
    [editable, selection],
  );

  // --- transform gesture (story 7) -------------------------------------------
  const gesture = useTransformGesture({
    doc,
    camera: cameraController.camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    // Every drag (z-order bump + move/resize frames) is one undo step
    // (undo.boundaries): boundary before the first change and at the end
    // (pointerup and pointercancel alike — the hook fires once per
    // activated gesture).
    onGestureStart: undo.boundary,
    onGestureEnd: undo.boundary,
  });

  // --- marquee (story 7) -------------------------------------------------------
  const marquee = useMarquee(cameraController.camera, objects, (ids) => {
    if (ids.length > 0) {
      selection.setMany(ids, true);
    }
  });

  // --- keyboard commands (story 7 + 8) -----------------------------------------
  useBoardKeys({ doc, selection, snapshot: objects, canEdit: editable, undo });

  // Test-only hooks (no-ops and tree-shaken in production builds).
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  useEffect(() => {
    installVidi6TestHooks(
      cameraController.setCamera,
      () => objectsRef.current,
      dropSocket,
      resumeSocket,
    );
  }, [cameraController.setCamera, dropSocket, resumeSocket]);

  // Keep the test hook's live connection state current (no-op in production).
  useEffect(() => {
    updateVidi6ConnectionState(connectionState);
  }, [connectionState]);

  /** Create a sticky note centred on a viewport-local point and start editing it. */
  const createAt = useCallback(
    (p: Point): void => {
      if (!editable) {
        return; // load_failed: editing is locked out (persist.client_status)
      }
      // One undo step per create (undo.boundaries); the editor's own mount
      // boundary keeps later typing out of the create step.
      undo.boundary();
      const id = createSticky(doc, screenToWorld(cameraController.camera, p));
      undo.boundary();
      if (id !== '') {
        // Select + start editing the new note immediately.
        selection.click(id);
        selection.startEdit(id);
      }
    },
    [doc, cameraController.camera, selection, editable, undo],
  );

  const createAtCentre = useCallback((): void => {
    createAt({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAt, viewport]);

  const deleteSelection = useCallback((): void => {
    if (!editable) {
      return; // load_failed: editing is locked out
    }
    const ids = [...selection.ids];
    if (ids.length === 0) {
      return;
    }
    // One undo step per delete (undo.boundaries).
    undo.boundary();
    if (deleteObjects(doc, ids) > 0) {
      selection.clear();
      undo.boundary();
    }
  }, [doc, selection, editable, undo]);

  const recolorSelection = useCallback(
    (c: StickyColor): void => {
      if (!editable) {
        return; // load_failed: editing is locked out
      }
      const id = selection.ids.values().next().value;
      if (id !== undefined && getStickyText(doc, id) !== undefined) {
        // One undo step per recolour (undo.boundaries).
        undo.boundary();
        setStickyColor(doc, id, c);
        undo.boundary();
      }
    },
    [doc, selection, editable, undo],
  );

  const ordered = renderOrder(objects);

  // The selection chrome (outline, handles, bar) is hidden during a
  // transform gesture and while a note is being edited (sel.interaction).
  const chromeVisible = selection.editingId === null;

  const selectedSticky =
    selection.ids.size === 1
      ? (objects.find(
          (o) => selection.ids.has(o.id) && o.type === 'sticky',
        ) as StickySnapshot | undefined)
      : undefined;

  return (
    <CameraContext.Provider value={cameraController}>
      <div
        ref={rootRef}
        data-testid="app-root"
        style={{ position: 'fixed', inset: 0, background: BOARD_BACKGROUND }}
      >
        <BoardViewport
          onDoubleClickEmpty={editable ? createAt : undefined}
          onEmptyClick={selection.clear}
          onMarqueeBegin={(p) => marquee.begin(p)}
          onMarqueeMove={(p) => marquee.move(p)}
          onMarqueeEnd={marquee.end}
          onMarqueeCancel={marquee.cancel}
          overlay={
            <>
              {chromeVisible && (
                <SelectionOverlay
                  ids={selection.ids}
                  snapshot={objects}
                  camera={cameraController.camera}
                  onHandlePointerDown={gesture.onHandlePointerDown}
                />
              )}
              <MarqueeRect rect={marquee.rect} camera={cameraController.camera} />
              {chromeVisible && selection.ids.size >= 2 && (
                <SelectionBar
                  ids={selection.ids}
                  snapshot={objects}
                  onDelete={deleteSelection}
                  disabled={!editable}
                />
              )}
            </>
          }
        >
          <OriginMarker />
          {/* Stable DOM order (renderOrder): a DOM move would release pointer
              capture and kill an in-flight drag; stacking is CSS z-index. */}
          {ordered.map((obj) => {
            const spec = getObjectType(obj.type);
            if (spec === undefined) {
              return null; // unknown type: ignored (forward compatibility)
            }
            const { Component } = spec;
            return (
              <Component
                key={obj.id}
                doc={doc}
                obj={obj}
                selected={selection.ids.has(obj.id)}
                editingId={selection.editingId}
                onPointerDown={gesture.onObjectPointerDown}
                onEdit={handleEdit}
                onEndEdit={handleEndEdit}
                onTextBoundary={undo.boundary}
                onTextUndo={undo.undo}
              />
            );
          })}
        </BoardViewport>
        <Toolbar onCreateSticky={createAtCentre} disabled={!editable} undo={undoActions} />
        <ConnectionStatus state={connectionState} />
        {chromeVisible && selectedSticky !== undefined && (
          <div
            style={{
              position: 'fixed',
              left:
                worldToScreen(cameraController.camera, {
                  x: selectedSticky.x + (selectedSticky.width ?? STICKY_SIZE_WORLD) / 2,
                  y: selectedSticky.y,
                }).x,
              top:
                worldToScreen(cameraController.camera, {
                  x: selectedSticky.x,
                  y: selectedSticky.y,
                }).y - 10,
              transform: 'translate(-50%, -100%)',
              zIndex: 3000,
            }}
          >
            <NoteToolbar
              color={selectedSticky.color}
              disabled={!editable}
              onColor={recolorSelection}
              onDelete={deleteSelection}
            />
          </div>
        )}
        <ZoomControls
          zoomPercent={zoomPercent(cameraController.camera)}
          canZoomIn={canZoomIn(cameraController.camera)}
          canZoomOut={canZoomOut(cameraController.camera)}
          onZoomIn={() => cameraController.zoomStep('in')}
          onZoomOut={() => cameraController.zoomStep('out')}
          onReset={cameraController.reset}
        />
        <NavigationHint visible={!cameraController.hasNavigated} />
      </div>
    </CameraContext.Provider>
  );
}
