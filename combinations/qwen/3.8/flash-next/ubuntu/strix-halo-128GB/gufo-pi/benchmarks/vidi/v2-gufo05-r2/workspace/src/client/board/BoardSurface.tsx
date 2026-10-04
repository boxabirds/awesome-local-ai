/**
 * The board itself: viewport, objects, the selection and its controls, zoom
 * controls and the connection badge, showing the one board `boardId` names.
 *
 * This is the whole of what story 1..4 put in `App.tsx`. Story 5 moved it here
 * unchanged and put a page around it (`pages/BoardPage.tsx`) whose only new job is
 * to find out whether that board exists before showing this — so nothing about
 * navigating, note editing or syncing is different because a board now has to have
 * been created to be seen.
 *
 * Story 7 put three things here: the objects are drawn through the type registry
 * rather than one component at a time; selection, moving and resizing are one
 * gesture hook shared by every type; and the keyboard works on the whole selection
 * at once.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Point,
} from '../canvas/camera';
import { CameraContext, useCamera, useViewportSize } from '../canvas/useCamera';
import { registerTestHooks } from '../canvas/testHooks';
import { Toolbar } from './Toolbar';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { useBoardKeys } from './useBoardKeys';
import { useTransformGesture } from './useTransformGesture';
import { SelectionBar } from './SelectionBar';
import { SelectionOverlay } from './SelectionOverlay';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { getObjectType, isSelectableObjectType, type ObjectProps } from '../objects/registry';
import {
  allObjectIds,
  createSticky,
  deleteObjects,
  objectBounds,
  objectsInRect,
  objectSnapshots,
  snapshot,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import { HANDLES, unionRects, type Handle, type Rect } from '../../shared/geometry';

/** Screen offset between a selection's top-left and its floating toolbar. */
const NOTE_TOOLBAR_GAP = 8;

/**
 * Whether this page may change the board right now.
 *
 * Everything the user does here is a local change to a document that syncs later, so
 * almost every state leaves the board editable: a dropped connection keeps the edits,
 * and they go out when it returns. One state is different. When the room says it
 * could not load the board, the document in front of the person is not a copy of
 * anything — an edit made now is a change to a board that does not exist, by them
 * alone. So creating, dragging, typing, recolouring and deleting stop while it says
 * so, and start again on their own the moment the board arrives.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export function BoardSurface({ boardId }: { boardId: string }) {
  const viewport = useViewportSize();
  const board = useCamera(viewport);
  const { camera } = board;
  const { doc, objects, connection } = useBoardDoc(boardId);

  // The one thing the connection state changes about the board itself.
  const editable = canEdit(connection);

  // What this page has selected, kept honest about what the board still holds: an
  // object somebody else deleted leaves the selection here (TC-35).
  const presentIds = useMemo(() => new Set(objects.map((object) => object.id)), [objects]);
  const selection = useSelection(presentIds);

  const gestures = useTransformGesture({
    doc,
    editable,
    camera,
    objects,
    selectedIds: selection.ids,
    click: selection.click,
    toggle: selection.toggle,
  });

  // Expose the live document to tests (no-op in production builds).
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    registerTestHooks({
      doc,
      getNotes: () => snapshot(doc) as StickySnapshot[],
      seedSticky: (x: number, y: number) => createSticky(doc, { x, y }),
      selectedIds: () => [...selectionRef.current.ids],
      objectCount: () => objectSnapshots(doc).length,
    });
  }, [doc]);

  // Create a note centred on a world point, then select + edit it.
  const createAtWorld = useCallback(
    (world: Point) => {
      if (!canEdit(connection)) return; // a note added to a board that never arrived
      const id = createSticky(doc, world);
      if (id) selection.startEdit(id);
    },
    [doc, selection, connection],
  );

  // The Sticky note button creates a note at the centre of the visible area.
  const createAtCentre = useCallback(() => {
    createAtWorld(screenCentre(camera, viewport));
  }, [camera, viewport, createAtWorld]);

  const deleteSelection = useCallback(() => {
    if (!editable) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, editable, selection]);

  useBoardKeys({
    doc,
    editable,
    objects,
    isSelectable: isSelectableObjectType,
    selectedIds: selection.ids,
    editingId: selection.editingId,
    selectAll: () => selection.setMany(allObjectIds(objects, isSelectableObjectType), false),
    clear: selection.clear,
    startEdit: selection.startEdit,
    deleteSelection,
  });

  // Shift + drag over empty space: the viewport owns the rectangle, the model owns
  // the rule about what is inside it.
  const marqueeSelect = useCallback(
    (rect: Rect, additive: boolean) => {
      selection.setMany(objectsInRect(objects, rect, isSelectableObjectType), additive);
    },
    [objects, selection],
  );

  // Render in a stable order (by id) so bringing an object to front — which
  // changes its z — never reorders the DOM and remounts it mid-drag. Stacking comes
  // from each object's CSS z-index instead. An object of a type this client cannot
  // draw is left out (forward compatibility); it cannot be selected either.
  const renderObjects = useMemo(
    () => objects.filter((object) => getObjectType(object.type) !== undefined).sort(byId),
    [objects],
  );

  const selectedObjects = useMemo(
    () => renderObjects.filter((object) => selection.ids.has(object.id)),
    [renderObjects, selection.ids],
  );

  // One outline around the whole selection, in board units.
  const selectionBox = useMemo(
    () => unionRects(selectedObjects.map(objectBounds)),
    [selectedObjects],
  );
  const transforming = gestures.mode !== 'idle';
  // While a resize is running the outline follows the box being dragged, which is
  // the result of the limit check rather than the selection. The handles go with it:
  // they stay the same eight, so the one under the pointer is still there from frame
  // to frame, and they move with the box the way a real control does.
  const outline = gestures.mode === 'resizing' && gestures.box ? gestures.box : selectionBox;
  const handles = resizeHandlesFor(selectedObjects);

  const toolbarAnchor = selectionBox
    ? worldToScreen(camera, { x: selectionBox.x, y: selectionBox.y })
    : { x: 0, y: 0 };
  // Hidden during a gesture: the bar must not sit under the thing being moved.
  const showBar =
    selection.count > 0 && !transforming && selection.editingId === null && selectionBox !== null;

  return (
    <CameraContext.Provider value={board}>
      <div className="vidi6-app">
        <BoardViewport
          onCreateStickyAt={createAtWorld}
          onClearSelection={selection.clear}
          onMarqueeSelect={marqueeSelect}
        >
          {renderObjects.map((object) => (
            <ObjectView
              key={object.id}
              object={object}
              doc={doc}
              zoom={camera.zoom}
              editable={editable}
              selected={selection.ids.has(object.id)}
              editing={selection.editingId === object.id}
              onObjectPointerDown={gestures.onObjectPointerDown}
              onStartEdit={selection.startEdit}
              onEndEdit={endEditWith(selection)}
            />
          ))}
          <SelectionOverlay
            box={outline}
            zoom={camera.zoom}
            handles={handles}
            onHandlePointerDown={gestures.onHandlePointerDown}
          />
        </BoardViewport>

        {showBar && (
          <div
            className="note-toolbar-anchor"
            style={{ left: toolbarAnchor.x, top: toolbarAnchor.y - NOTE_TOOLBAR_GAP }}
          >
            <SelectionBar
              ids={selection.ids}
              objects={objects}
              doc={doc}
              editable={editable}
              onDelete={deleteSelection}
            />
          </div>
        )}

        {/* What the selection is, for a screen reader: the outline is decoration. */}
        <div className="visually-hidden" role="status" aria-live="polite">
          {selection.count > 1 ? `${selection.count} selected` : ''}
        </div>

        <Toolbar onCreateSticky={createAtCentre} createDisabled={!editable} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => board.zoomStep('in')}
          onZoomOut={() => board.zoomStep('out')}
          onReset={board.reset}
        />
        <NavigationHint visible={!board.hasNavigated} />
        <ConnectionStatus state={connection} />
      </div>
    </CameraContext.Provider>
  );
}

/**
 * One object, drawn by the component its type registered. Everything the component
 * needs arrives as one props object, so a type added by a later story needs no
 * change to this file.
 */
function ObjectView(props: ObjectProps) {
  const spec = getObjectType(props.object.type);
  if (!spec) return null;
  const { Component } = spec;
  return <Component {...props} />;
}

/**
 * The handles to draw: the eight of a box, when every selected object can be
 * resized. A type that cannot be resized (a future stroke) takes the handles away
 * from a mixed selection too — a control that does nothing is worse than none.
 */
function resizeHandlesFor(objects: readonly ObjectSnapshot[]): readonly Handle[] {
  if (objects.length === 0) return [];
  return objects.every((object) => getObjectType(object.type)?.resizable) ? HANDLES : [];
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Ending an edit leaves the object selected, ready to be moved again. */
function endEditWith(selection: ReturnType<typeof useSelection>) {
  return (next: 'selected' | 'unselected') => {
    if (next === 'selected') selection.stopEdit();
    else selection.clear();
  };
}

function screenCentre(
  camera: { x: number; y: number; zoom: number },
  viewport: { width: number; height: number },
): Point {
  // The world point at the centre of the visible board area.
  return screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 });
}
