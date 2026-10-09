import { useCallback, useRef, type JSX } from 'react';
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
import { CameraApiContext, useCamera, useViewportSize } from '../canvas/useCamera';
import { useBoardDoc } from './useBoardDoc';
import { useSelection, type EndEditNext } from './useSelection';
import { useTransformGesture } from './useTransformGesture';
import { useBoardKeys } from './useBoardKeys';
import { MarqueeRect, useMarquee } from './Marquee';
import { SelectionBar } from './SelectionBar';
import { SelectionOverlay } from './SelectionOverlay';
import { Toolbar } from './Toolbar';
import { getObjectComponent } from '../objects/registry';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit as connectionAllowsEditing } from '../sync/connectBoard';
import { createSticky, deleteObjects, objectBounds } from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';

/**
 * The board itself: everything stories 1–4 built, mounted on one board id that has already
 * been checked for (`BoardPage`, story 5).
 *
 * Story 7 moved three things out of `StickyNote` and into components that work for every
 * object type: which objects are selected (`useSelection`, now a set), what happens when
 * the pointer presses something (`useTransformGesture`), and what the keys do
 * (`useBoardKeys`). What is left here is the wiring — the document, the camera, and one
 * component per object, rendered through the registry so a type this build does not know is
 * skipped instead of breaking the page.
 *
 * Selection, editing, the gesture and the marquee stay in React state, never in the
 * document: a board with six people has six selections on it and exactly one of them is
 * yours.
 */
export function Board({ boardId }: { boardId: string }): JSX.Element {
  const viewport = useViewportSize();
  const cameraApi = useCamera(viewport);
  const { camera, hasNavigated } = cameraApi;
  const { doc, objects, connection } = useBoardDoc(boardId);
  const selection = useSelection(objects);
  // A board that could not be loaded is shown and refuses every edit (story 4); no other
  // connection state refuses anything.
  const canEdit = connectionAllowsEditing(connection);

  // Handlers that run long after a render read the latest values through refs.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  /**
   * Create a note centred on a screen point: `createSticky` stores the top-left, so it
   * subtracts half a note itself. The new note is on top and is being typed into right
   * away, wherever the board has been panned.
   */
  const createAtScreenPoint = useCallback(
    (screenPoint: Point): void => {
      if (!canEdit) return; // no edits on a board that failed to load
      const world = screenToWorld(cameraRef.current, screenPoint);
      const id = createSticky(doc, world);
      if (id === false) return;
      selectionRef.current.startEdit(id);
    },
    [doc, canEdit],
  );

  /** The Sticky note button: the centre of the visible board area. */
  const createAtViewportCentre = useCallback((): void => {
    createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreenPoint, viewport.width, viewport.height]);

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit,
  });

  /** The marquee adds to what is already selected (sel.marquee). */
  const marquee = useMarquee(camera, objects, (ids) => {
    selectionRef.current.setMany(ids, true);
  });

  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit,
    marqueeActive: marquee.rect !== null,
  });

  /**
   * Editing ends either because the object was pressed again (it stays selected) or because
   * the pointer went down somewhere else, which is also a click and so takes its own
   * selection with it — story 2's rule, kept for the object it applies to.
   */
  const endEdit = useCallback((next: EndEditNext): void => {
    if (next === 'unselected') selectionRef.current.clear();
    selectionRef.current.endEdit();
  }, []);

  const deleteSelection = useCallback((): void => {
    if (!canEdit) return;
    const ids = [...selectionRef.current.ids];
    if (ids.length === 0) return;
    deleteObjects(doc, ids);
    selectionRef.current.clear();
  }, [canEdit, doc]);

  // The selection bar sits above its bounding box, in screen pixels, and only while
  // nothing is being typed in — an editor and a delete button are not a good pair.
  const selected = objects.filter((object) => selection.ids.has(object.id));
  const box = selection.editingId === null ? unionRects(selected.map(objectBounds)) : null;
  const barAt =
    box && canEdit && selected.length >= 2
      ? worldToScreen(camera, { x: box.x + box.width / 2, y: box.y })
      : null;

  return (
    <CameraApiContext.Provider value={cameraApi}>
      <main className="vidi6-app" data-testid="app">
        <BoardViewport
          onCreateStickyAt={createAtScreenPoint}
          onEmptyClick={() => {
            selectionRef.current.clear();
          }}
          marquee={marquee}
          overlay={
            <>
              {/* While somebody's text is being edited the handles are put away: a press on
                  one would resize the very object that has the caret in it, and the box is
                  not what the user is looking at. The outline on the object stays. */}
              {selection.editingId === null ? (
                <SelectionOverlay
                  ids={selection.ids}
                  snapshot={objects}
                  camera={camera}
                  onHandlePointerDown={gesture.onHandlePointerDown}
                />
              ) : null}
              <MarqueeRect rect={marquee.rect} camera={camera} />
            </>
          }
        >
          {objects.map((object) => {
            const Component = getObjectComponent(object);
            // An object of a type this build does not know is not drawn, not selectable
            // and not resized (TC-08): a document written by a later story still opens.
            if (!Component) return null;
            return (
              <Component
                key={object.id}
                object={object}
                doc={doc}
                zoom={camera.zoom}
                selected={selection.ids.has(object.id)}
                selectedCount={selection.ids.size}
                editing={selection.editingId === object.id}
                dragging={gesture.dragging && selection.ids.has(object.id)}
                readOnly={!canEdit}
                onSelect={selection.click}
                onObjectPointerDown={gesture.onObjectPointerDown}
                onStartEdit={selection.startEdit}
                onEndEdit={endEdit}
              />
            );
          })}
        </BoardViewport>
        {barAt ? (
          <div
            className="vidi6-selection-bar-anchor"
            data-testid="selection-bar-anchor"
            style={{ left: `${barAt.x}px`, top: `${barAt.y}px` }}
          >
            <SelectionBar ids={selection.ids} snapshot={objects} onDelete={deleteSelection} />
          </div>
        ) : null}
        <ConnectionStatus state={connection} />
        <Toolbar onCreateSticky={createAtViewportCentre} disabled={!canEdit} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => cameraApi.zoomStep('in')}
          onZoomOut={() => cameraApi.zoomStep('out')}
          onReset={cameraApi.reset}
        />
        <NavigationHint visible={!hasNavigated} />
      </main>
    </CameraApiContext.Provider>
  );
}
