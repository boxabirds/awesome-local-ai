import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
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
import { DEFAULT_TOOL, useTool } from './useTool';
import { MarqueeRect, useMarquee } from './Marquee';
import { SelectionBar } from './SelectionBar';
import { SelectionOverlay } from './SelectionOverlay';
import { Toolbar } from './Toolbar';
import { createUndo } from './undo';
import { UndoContext, useUndo } from './useUndo';
import { getObjectComponent } from '../objects/registry';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit as connectionAllowsEditing } from '../sync/connectBoard';
import { createSticky, deleteObjects, objectBounds } from '../../shared/board-model';
import {
  createText,
  isTextSnapshot,
  readText,
  setTextSize,
  type TextSize,
} from '../../shared/objects/text';
import { unionRects } from '../../shared/geometry';
import { useLocalIdentity } from '../useLocalIdentity';
import { defaultMeasurer } from '../objects/textLayout';
import { remeasureTextBox, remeasureTextBoxes } from '../objects/useTextBoxSync';

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
 *
 * Story 8 adds the undo history, which is exactly as local as the selection is: this tab's
 * own changes, for as long as this tab is open. It is created here, with the document, and
 * handed to the keys, the gesture, the toolbar and — through `UndoContext` — the objects that
 * edit text, so that a change made anywhere on the board opens a step in the same history.
 *
 * Story 9 adds the third local thing, the tool mode: which tool this tab is on is decided
 * here, and only decides where the next click on the viewport goes.
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

  // One history per document: it is empty when the board opens, holds this tab's changes
  // while it is open, and goes with the document (`undo.session_only`, TC-11).
  const undo = useMemo(() => createUndo(doc), [doc]);
  useEffect(
    () => () => {
      undo.destroy();
    },
    [undo],
  );
  const undoState = useUndo(undo, canEdit);

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
      // One click makes one note, and one note is one undo step even when the button is
      // clicked twice in a second.
      undo.boundary();
      const id = createSticky(doc, world);
      undo.boundary();
      if (id === false) return;
      selectionRef.current.startEdit(id);
    },
    [doc, canEdit, undo],
  );

  /** The Sticky note button: the centre of the visible board area. */
  const createAtViewportCentre = useCallback((): void => {
    createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreenPoint, viewport.width, viewport.height]);

  /** Which pointer tool this tab is on: Select, or Text. `n` still makes a note (TC-17). */
  const tool = useTool({ canEdit, onCreateSticky: createAtViewportCentre });
  const setTool = tool.setTool;

  /**
   * The Text tool's click (story 9): an empty text with its top-left where the pointer was,
   * in the automatic width mode and at the default size, already being typed into — and the
   * pointer back on Select, because the tool asked for one thing to be put down (PRD: "the
   * tool switches back to Select"). Writing the next line means pressing T again, which is
   * what a tool that vanishes after one click is worth: nothing by accident.
   */
  const identity = useLocalIdentity();
  const createTextAtScreenPoint = useCallback(
    (screenPoint: Point): void => {
      if (!canEdit) return; // no edits on a board that failed to load
      const world = screenToWorld(cameraRef.current, screenPoint);
      // One click makes one text, and one text is one undo step however fast the clicks come.
      undo.boundary();
      const id = createText(doc, world, identity);
      undo.boundary();
      if (id === null) return;
      setTool(DEFAULT_TOOL);
      selectionRef.current.startEdit(id);
    },
    [doc, canEdit, undo, identity, setTool],
  );

  // One canvas measurer for this board, shared with every text object on it.
  const measurer = useMemo(() => defaultMeasurer(), []);

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit,
    // A drag is one undo step whatever it did on the way (TC-14): the gesture announces
    // itself at `begin` and again when the pointer is released or taken away.
    onGestureStart: undo.boundary,
    // A resize may have made a text narrower or wider, and a text's height is whatever its
    // content now needs: it is measured once more, inside the same undo step (TC-27).
    // Ids that are not text are ignored, which is how a mixed selection is left alone.
    onGestureEnd: () => {
      remeasureTextBoxes(doc, selectionRef.current.ids, measurer);
      undo.boundary();
    },
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
    undo,
    tool,
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
    // The selection bar's Delete and the keyboard's are the same step: one press, one step,
    // however many objects it takes away (TC-04).
    undo.boundary();
    deleteObjects(doc, ids);
    undo.boundary();
    selectionRef.current.clear();
  }, [canEdit, doc, undo]);

  // The selection bar sits above its bounding box, in screen pixels, and only while
  // nothing is being typed in — an editor and a delete button are not a good pair.
  const selected = objects.filter((object) => selection.ids.has(object.id));
  const box = selection.editingId === null ? unionRects(selected.map(objectBounds)) : null;

  /**
   * Story 9: the text controls the bar shows for exactly one selected text object. The size
   * is read from the document rather than from the snapshot, because the snapshot only holds
   * the fields every object has. Deleting is the bar's own delete, unchanged: one press, one
   * undo step, whatever type it happens to take away (TC-28).
   */
  const selectedText =
    canEdit && selected.length === 1 && isTextSnapshot(selected[0])
      ? readText(doc, selected[0].id)
      : undefined;
  const textId = selectedText?.id;

  const changeTextSize = useCallback(
    (size: TextSize): void => {
      if (!canEdit || !textId) return;
      // A size change is its own undo step, and its own measurement: the box that comes back
      // the same size it was costs the document nothing (TC-13).
      undo.boundary();
      setTextSize(doc, textId, size);
      remeasureTextBox(doc, textId, measurer);
      undo.boundary();
    },
    [canEdit, doc, measurer, textId, undo],
  );

  const barAt =
    box &&
    canEdit &&
    (selected.length >= 2 || (selected.length === 1 && selectedText !== undefined))
      ? worldToScreen(camera, { x: box.x + box.width / 2, y: box.y })
      : null;

  return (
    <CameraApiContext.Provider value={cameraApi}>
      <UndoContext.Provider value={undo}>
      <main className="vidi6-app" data-testid="app">
        <BoardViewport
          onCreateStickyAt={createAtScreenPoint}
          onEmptyClick={() => {
            selectionRef.current.clear();
          }}
          marquee={marquee}
          tool={tool.tool}
          onTextToolClick={createTextAtScreenPoint}
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
            <SelectionBar
              ids={selection.ids}
              snapshot={objects}
              onDelete={deleteSelection}
              text={
                selectedText
                  ? { size: selectedText.size, onSize: changeTextSize }
                  : null
              }
            />
          </div>
        ) : null}
        <ConnectionStatus state={connection} />
        <Toolbar
          onCreateSticky={createAtViewportCentre}
          tool={tool.tool}
          onSelectTool={() => tool.setTool('select')}
          onTextTool={() => tool.setTool('text')}
          disabled={!canEdit}
          undo={undoState}
        />
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
      </UndoContext.Provider>
    </CameraApiContext.Provider>
  );
}
