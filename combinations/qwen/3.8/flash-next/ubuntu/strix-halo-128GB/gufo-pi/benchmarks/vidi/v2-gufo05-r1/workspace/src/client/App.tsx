/**
 * Top-level layout: the full-window board plus its fixed overlays.
 *
 * `CameraProvider` owns the camera (`useCamera`); `BoardLayout` reads it and
 * wires it to the viewport, the zoom controls and the navigation hint, and adds
 * the collaborative layer: the shared document (`useBoardDoc`), the local
 * selection (`useSelection`) and the objects drawn from the snapshot.
 *
 * Story 7 moved the board's whole way of drawing objects through here: `App` asks the
 * registry what a type is and renders the component it answers with, and it passes the
 * same `ObjectProps` to every one of them. That is why nothing below mentions sticky
 * notes — the selection, the drag, the resize handles, the marquee and the selection bar
 * are wired once and work for every type the registry knows, which is the promise
 * `sel.all_types` makes for stories 9 to 12.
 *
 * Three things are deliberately not in the document: selection and editing (local
 * only, see `useSelection`), the camera (story 1), and the selection rectangle, which
 * exists only while the pointer is down.
 */
import { useCallback, useMemo, useRef, type JSX } from 'react';
import type * as Y from 'yjs';

import { isValidBoardId } from '../shared/board-id';
import {
  createSticky,
  deleteObjects,
  objectBounds,
  type ObjectSnapshot,
} from '../shared/board-model';
import { createText } from '../shared/objects/text';
import { unionRects } from '../shared/geometry';
import { MarqueeRect } from './board/Marquee';
import { SelectionBar } from './board/SelectionBar';
import { SelectionOverlay } from './board/SelectionOverlay';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useBoardKeys } from './board/useBoardKeys';
import { useMarquee } from './board/useMarquee';
import { useSelection } from './board/useSelection';
import { useTool } from './board/useTool';
import { useUndo, useUndoController } from './board/useUndo';
import { SELF } from './identity';
import { useTransformGesture } from './board/useTransformGesture';
import { BoardViewport } from './canvas/BoardViewport';
import { CameraProvider, useCameraContext } from './canvas/CameraContext';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { getObjectType, isRenderable } from './objects/registry';
import { ConnectionStatus, canEdit as connectionAllowsEditing } from './sync/ConnectionStatus';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Camera,
  type Point,
} from './canvas/camera';
import { useWindowSize } from './canvas/useCamera';
import { useRoute } from './router';
import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';

export interface AppProps {
  /** Bring your own document; the default is a fresh one (tests pass one). */
  doc?: Y.Doc;
  /**
   * The board this page is showing, from `/b/:boardId`. Without it the board is
   * local only: no room is opened, and nothing is reported about a connection.
   */
  boardId?: string;
}

/**
 * The board this address names, or `null` when it names none: anything that is
 * not `/b/<boardId>`, and `/b/<something that is not an id>`.
 *
 * Validation is `isValidBoardId`, the same rule the Worker applies to
 * `/api/rooms/:boardId`, so a page and its room never disagree about whether an
 * address can name a board. Saying so on screen is story 5's page; here it simply
 * means *no room*, which is the honest reading of an address that cannot have one.
 */
export function boardIdFromPath(pathname: string): string | null {
  const match = /^\/b\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  const candidate = match[1];
  return candidate !== undefined && isValidBoardId(candidate) ? candidate : null;
}

/**
 * What this address shows: the home page, a board, or the page for an address that is
 * not one.
 *
 * Three pages and no router library (`src/client/router.ts`). The board is `App` below —
 * the component stories 1 to 4 built and tested — reached through `BoardPage`, which asks
 * the Worker whether the address is a board before it mounts and adds the Share button
 * that makes the address worth sending to somebody. Until story 5 this file opened a
 * board at whatever address it was given, which is the thing the sharing story undoes:
 * an address used to *make* a board, and now only the home page's button does.
 */
export function AppRoot(): JSX.Element {
  const route = useRoute();
  if (route.name === 'home') return <HomePage />;
  if (route.name === 'board') return <BoardPage id={route.id} />;
  return <NotFoundPage />;
}

/**
 * Where the selection bar goes: centred above the selection's bounding box, in screen
 * pixels, so it stays the same size however far the board is zoomed out.
 *
 * Returns null when nothing is selected. The bar is positioned here, and not by
 * `SelectionBar`, because only this component has the camera.
 */
function selectionAnchor(
  camera: Camera,
  objects: readonly ObjectSnapshot[],
  ids: ReadonlySet<string>,
): Point | null {
  const rects = objects.filter((object) => ids.has(object.id)).map(objectBounds);
  const box = unionRects(rects);
  if (!box) return null;
  return worldToScreen(camera, { x: box.x + box.width / 2, y: box.y });
}

function BoardLayout({ doc, boardId }: AppProps) {
  const nav = useCameraContext();
  const { camera } = nav;
  const viewport = useWindowSize();
  const board = useBoardDoc(boardId, doc);

  // What this build can draw. Every gesture, the outlines and the bar work on this
  // list, never on the whole document: an object whose type has no component is not
  // drawn, cannot be selected by the marquee or by select-all, and cannot be moved —
  // which is what keeps an object from a newer client from being half-handled here
  // (`sel.registry`).
  const objects = useMemo(
    () => board.objects.filter((object) => isRenderable(object.type)),
    [board.objects],
  );

  const selection = useSelection(objects);
  const canEdit = connectionAllowsEditing(board.connectionState);
  // Which tool a click on the board is in: Select, or Text (`text.tool_ui`).
  const tools = useTool(canEdit);

  // One undo history per board document, for this person alone (story 8). It watches the
  // document rather than being told about the changes, so nothing here has to remember to
  // report a mutation: what this tab writes with `LOCAL_ORIGIN` is in it, and what arrives
  // from anybody else is not.
  const undoController = useUndoController(board.doc);
  const undo = useUndo(undoController, canEdit);

  /** One model call is one undo step, whatever the pointer did around it. */
  const stepBoundary = undoController.boundary;

  // Latest values for the callbacks that are created once.
  const latestRef = useRef({ camera, selection, doc: board.doc, connectionState: board.connectionState });
  latestRef.current = { camera, selection, doc: board.doc, connectionState: board.connectionState };

  /** Delete everything selected, and clear the selection (`sel.group_delete`). */
  const deleteSelection = useCallback(() => {
    if (!canEdit) return;
    // Twenty notes gone is one thing that happened, so it is one step back (`undo.steps`).
    stepBoundary();
    deleteObjects(latestRef.current.doc, [...latestRef.current.selection.ids]);
    stepBoundary();
    latestRef.current.selection.clear();
  }, [canEdit, stepBoundary]);

  // Shift+drag on empty space. It adds to the selection, so a second rectangle grows
  // it instead of starting over (`sel.marquee`).
  const marquee = useMarquee(camera, objects, (ids) => {
    selection.setMany(ids, true);
  });

  // Drag an object: move the selection. Drag a handle: resize it. The two boundary calls
  // are what make a whole drag one undo step: every frame it writes falls inside the open
  // window, and nothing written after the pointer came up does too (`undo.steps`).
  const gesture = useTransformGesture({
    doc: board.doc,
    camera,
    selection,
    snapshot: objects,
    canEdit,
    onGestureStart: stepBoundary,
    onGestureEnd: stepBoundary,
  });

  useBoardKeys({
    doc: board.doc,
    selection,
    snapshot: objects,
    canEdit,
    marqueeActive: () => marquee.active,
    undo: undoController,
    tool: tools,
    onCreateSticky: () => createAtCentre(),
  });

  /** Put a note on the board centred on a world point and start typing it. */
  const createAt = useCallback(
    (point: Point) => {
      if (!connectionAllowsEditing(latestRef.current.connectionState)) return;
      // Making a note is a step, and the typing that starts a moment later is another.
      stepBoundary();
      const id = createSticky(latestRef.current.doc, point);
      stepBoundary();
      if (!id) return;
      // The note is new, so the selection has not heard of it yet: say that it exists
      // before selecting it, or the check that keeps a stale id out of a selection
      // would keep this one out too.
      selection.add(id);
      selection.startEdit(id);
    },
    [selection, stepBoundary],
  );

  const createAtCentre = useCallback(() => {
    createAt(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [camera, createAt, viewport.height, viewport.width]);

  /**
   * Put text at a world point and start writing it (`text.create`).
   *
   * Unlike a note, the point is the text's top-left rather than its centre: a person
   * clicking with the Text tool is saying where the first character goes, and centring
   * an empty box on the cursor would put the words somewhere they did not click.
   */
  const createTextAt = useCallback(
    (point: Point) => {
      if (!connectionAllowsEditing(latestRef.current.connectionState)) return;
      // Placing the text is one step, and what gets typed into it is the next.
      stepBoundary();
      const id = createText(latestRef.current.doc, point, SELF.id);
      stepBoundary();
      if (!id) return;
      selection.add(id);
      selection.startEdit(id);
      // A tool that stayed armed after its one click would take the click that was
      // meant for selecting, or for moving the text that is now being typed.
      tools.setTool('select');
    },
    [selection, stepBoundary, tools],
  );

  const anchor = selectionAnchor(camera, objects, selection.ids);

  return (
    <div className={`app${gesture.isTransforming ? ' transform--active' : ''}`}>
      <ConnectionStatus state={board.connectionState} />
      <Toolbar
        onCreateSticky={createAtCentre}
        tool={tools.tool}
        canEdit={canEdit}
        onTool={tools.setTool}
        undo={undo}
      />
      <BoardViewport
        onEmptyDoubleClick={(point) => {
          createAt(screenToWorld(camera, point));
        }}
        onEmptyClick={() => {
          // A click on empty board space, with no drag: the selection goes away
          // (`sel.clear`).
          selection.clear();
        }}
        marquee={marquee}
        textMode={tools.tool === 'text'}
        onTextPointClick={(point) => {
          createTextAt(screenToWorld(camera, point));
        }}
      >
        {objects.map((object) => {
          const spec = getObjectType(object.type);
          if (!spec) return null; // filtered above; the compiler does not know that
          const Component = spec.Component;
          return (
            <Component
              key={object.id}
              obj={object}
              doc={board.doc}
              zoom={camera.zoom}
              selected={selection.has(object.id)}
              editing={selection.editingId === object.id}
              canEdit={canEdit}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onFocusSelect={selection.selectOnly}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
              undo={undoController}
            />
          );
        })}
        <MarqueeRect rect={marquee.rect} camera={camera} />
      </BoardViewport>
      {/*
       * Screen space, above the board: the bar first, then the outlines and handles.
       *
       * The order is the tab order. A person on a keyboard who has selected a note reaches
       * its colours and its bin before the eight resize handles, which is what story 2
       * established and what eight new stops would otherwise have buried. z-index, not
       * this order, decides what is drawn on top.
       */}
      {anchor && !gesture.isTransforming ? (
        <div
          className="selection-anchor"
          style={{ left: anchor.x, top: anchor.y }}
        >
          <SelectionBar
            ids={selection.ids}
            snapshot={objects}
            doc={board.doc}
            onDelete={deleteSelection}
            boundary={stepBoundary}
          />
        </div>
      ) : null}
      <SelectionOverlay
        selection={[...selection.ids]}
        snapshot={objects}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => {
          nav.zoomStep('in');
        }}
        onZoomOut={() => {
          nav.zoomStep('out');
        }}
        onReset={nav.reset}
      />
      <NavigationHint visible={!nav.hasNavigated} />
    </div>
  );
}

export function App({ doc, boardId }: AppProps = {}) {
  const fromAddress = boardIdFromPath(window.location.pathname);
  return (
    <CameraProvider>
      <BoardLayout boardId={boardId ?? fromAddress ?? undefined} doc={doc} />
    </CameraProvider>
  );
}


