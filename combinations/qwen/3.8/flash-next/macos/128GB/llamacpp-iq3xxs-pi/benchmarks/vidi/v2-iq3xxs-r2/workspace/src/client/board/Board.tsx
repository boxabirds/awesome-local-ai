import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
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
import { DEFAULT_TOOL } from './useTool';
import { useActiveTool } from '../tools/useActiveTool';
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
import { CONNECTOR_TYPE } from '../../shared/objects/connector';
import type { Rect } from '../../shared/geometry';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { PenTool } from '../tools/PenTool';
import { PenToolbar } from '../tools/PenToolbar';
import { usePenOptions } from '../tools/usePenOptions';
import {
  createText,
  isTextSnapshot,
  readText,
  setTextSize,
  type TextSize,
} from '../../shared/objects/text';
import { unionRects } from '../../shared/geometry';
import { useLocalIdentity } from '../useLocalIdentity';
import { useImageInsert, type ImageInsertControls } from '../images/useImageInsert';
import { DropHighlight, useFileDragOver } from '../images/DropHighlight';
import { IMAGE_CLOCK_TICK_MS, ImageBoardContextProvider } from '../objects/ImageObject';
import { ToastRegion } from '../ui/Toast';
import { canUploadImages } from '../images/useImageInsert';
import { IMAGE_TYPE } from '../../shared/objects/image';
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

  /**
   * Which pointer tool this tab is on: Select, Text, Shape or Connector. `n` still makes a
   * note (TC-17), and the tools that make something hand the pointer back to Select holding
   * what they made selected (`tools.return_to_select`).
   */
  const selectOnly = useCallback((id: string): void => {
    selectionRef.current.select(id);
  }, []);
  /*
   * Story 12: the Image tool's action, which is "open the file picker" and nothing else — the
   * pointer never sits on it, and no click means anything differently while it is "up"
   * (`image.pick`). It is read through a ref because the hook that owns the picker needs the
   * identity below, and a tool that changes the picker should not have to care what order the
   * hooks are in.
   */
  const insertRef = useRef<ImageInsertControls | null>(null);
  const openImagePicker = useCallback((): void => {
    insertRef.current?.openPicker();
  }, []);
  const tool = useActiveTool({
    canEdit,
    onCreateSticky: createAtViewportCentre,
    onSelectOnly: selectOnly,
    onImageTool: openImagePicker,
  });
  const setTool = tool.setTool;

  /**
   * The Text tool's click (story 9): an empty text with its top-left where the pointer was,
   * in the automatic width mode and at the default size, already being typed into — and the
   * pointer back on Select, because the tool asked for one thing to be put down (PRD: "the
   * tool switches back to Select"). Writing the next line means pressing T again, which is
   * what a tool that vanishes after one click is worth: nothing by accident.
   */
  const identity = useLocalIdentity();
  /**
   * What the next stroke is drawn with: session state, like the tool itself, so a pen is as
   * local as a selection and reloads back to black and Medium (`pen.options`).
   */
  const penOptions = usePenOptions();
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

  /*
   * Story 12: adding images. Drop, paste and the picker differ only in where the images land,
   * so the hook is handed the camera and the viewport as well as the document, and the board
   * stays out of everything else — the placeholders, the uploads, the progress and the
   * messages are its business (`image.insert`).
   */
  const insert = useImageInsert({
    doc,
    boardId,
    camera,
    viewport,
    connection,
    identityId: identity,
  });
  insertRef.current = insert;

  // A paste is heard at the window rather than on the board, because the board has no focus
  // ring and no caret: the person who presses Cmd+V after clicking a note expects the note to
  // be typed into and the board to get nothing, and `onPaste` is the one that decides (PRD:
  // "IF text is being edited THEN THE SYSTEM SHALL NOT add an image").
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      insertRef.current?.onPaste(event);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  /**
   * The clock the image boxes are drawn with, which moves only while there is an image to
   * draw. It exists for one reason: `image.unfinished` is a judgement about time, and a viewer
   * who watched a spinner for five minutes has to see it change without having to reload.
   */
  const hasImages = objects.some((object) => object.type === IMAGE_TYPE);
  const [imageClock, setImageClock] = useState(() => Date.now());
  useEffect(() => {
    if (!hasImages) return;
    // Re-based when an image appears, so a board opened onto a stale upload says so on the
    // first draw rather than after a tick.
    setImageClock(Date.now());
    const timer = setInterval(() => setImageClock(Date.now()), IMAGE_CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [hasImages]);

  /**
   * What an image object needs and the document does not hold: this tab's progress, this tab's
   * identity, this tab's clock, and the way to retry. Everything else an image draws from is in
   * the document, which is why another person's placeholder appears on this board with no code
   * here knowing anything about it.
   */
  const imageContext = useMemo(
    () => ({
      progress: insert.progress,
      identityId: identity,
      now: imageClock,
      retry: insert.retry,
      canRetry: insert.canRetry,
    }),
    [identity, imageClock, insert.canRetry, insert.progress, insert.retry],
  );

  // The dashed frame that says letting go here will add the pictures being carried. It is
  // shown when they could be added: over a board that cannot be written to, or while the
  // upload has nowhere to go, the honest frame is no frame (`image.offline`).
  const draggingFiles = useFileDragOver(canEdit && canUploadImages(connection));

  // One canvas measurer for this board, shared with every text object on it.
  const measurer = useMemo(() => defaultMeasurer(), []);

  /**
   * Every object's box, by id, for the one thing that needs it: an arrow being re-attached
   * asks which object its end is over (design: connector.reattach). Arrows are left out — an
   * arrow's box is its ends, so its own box would answer that question about itself.
   */
  const rects = useMemo(() => {
    const boxes = new Map<string, Rect>();
    for (const object of objects) {
      if (object.type === CONNECTOR_TYPE) continue;
      boxes.set(object.id, objectBounds(object));
    }
    return boxes;
  }, [objects]);

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
          onDragOver={insert.onDragOver}
          onDrop={insert.onDrop}
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
              {/* Story 12: the drop highlight, drawn over the board rather than over the page,
                  because the board is what accepts the drop. */}
              {draggingFiles ? <DropHighlight /> : null}
              {/* Story 10: the Shape and Connector tools are surfaces over the viewport, so a
                  drag that starts on top of an object draws a shape or an arrow instead of
                  moving that object (TC-28). They are mounted only while they are the tool in
                  hand — a surface that is not the tool in hand would swallow the pointer for
                  nothing — and never over a board this client may not write to. */}
              {canEdit && tool.tool === 'shape' ? (
                <ShapeTool
                  kind={tool.shapeKind}
                  camera={camera}
                  doc={doc}
                  createdBy={identity}
                  onCreated={tool.toolCreated}
                />
              ) : null}
              {canEdit && tool.tool === 'connector' ? (
                <ConnectorTool
                  camera={camera}
                  snapshot={objects}
                  doc={doc}
                  createdBy={identity}
                  onCreated={tool.toolCreated}
                />
              ) : null}
              {/* Story 11: the Pen is the same kind of surface, with the opposite manners — it
                  keeps the tool up after every stroke, so it never calls `toolCreated` and never
                  selects what it made. The line being drawn lives in this component: it is drawn
                  for this tab only, and only the finished stroke reaches anybody else. */}
              {canEdit && tool.tool === 'pen' ? (
                <PenTool
                  camera={camera}
                  color={penOptions.color}
                  thickness={penOptions.thickness}
                  doc={doc}
                  identityId={identity}
                />
              ) : null}
            </>
          }
        >
          <ImageBoardContextProvider value={imageContext}>
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
                rects={rects}
                readOnly={!canEdit}
                onSelect={selection.click}
                onObjectPointerDown={gesture.onObjectPointerDown}
                onStartEdit={selection.startEdit}
                onEndEdit={endEdit}
              />
            );
          })}
          </ImageBoardContextProvider>
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
        {/* Story 12: the only words the board says to one person rather than to everybody —
            a refusal to add a file is not a thing that happens to the document. */}
        <ToastRegion />
        <Toolbar
          onCreateSticky={createAtViewportCentre}
          tool={tool.tool}
          onSelectTool={() => tool.setTool('select')}
          onTextTool={() => tool.setTool('text')}
          onShapeTool={() => tool.setTool('shape')}
          onConnectorTool={() => tool.setTool('connector')}
          onPenTool={() => tool.setTool('pen')}
          onImageTool={tool.imageTool}
          shapeKind={tool.shapeKind}
          onShapeKind={tool.setShapeKind}
          disabled={!canEdit}
          undo={undoState}
        />
        {/* The pen toolbar belongs to the tool rather than to the toolbar: it is only ever
            relevant while the Pen is up, and it is next to the toolbar rather than in it, so
            choosing a colour does not read as changing tools (PRD: "a pen toolbar appears next to
            the left toolbar"). */}
        {canEdit && tool.tool === 'pen' ? (
          <div className="vidi6-pen-toolbar-anchor" data-testid="pen-toolbar-anchor">
            <PenToolbar
              color={penOptions.color}
              thickness={penOptions.thickness}
              onColor={penOptions.setColor}
              onThickness={penOptions.setThickness}
            />
          </div>
        ) : null}
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
