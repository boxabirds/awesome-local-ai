import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { newBoardId } from '../../shared/board-id';
import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import { useCamera } from '../canvas/useCamera';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point, type Size } from '../canvas/camera';
import { useBoardDoc } from './useBoardDoc';
import { useUndo, useUndoController } from './useUndo';
import { useSelection } from './useSelection';
import { SelectionBar } from './SelectionBar';
import { SelectionOverlay } from './SelectionOverlay';
import { useMarquee, MarqueeRect } from './Marquee';
import { useTransformGesture } from './useTransformGesture';
import { useBoardKeys } from './useBoardKeys';
import { Toolbar } from './Toolbar';
import { useToolKeys } from './useTool';
import { StickyNote } from '../objects/StickyNote';
import { TextObject } from '../objects/TextObject';
import { ShapeObject } from '../objects/ShapeObject';
import { ConnectorObject } from '../objects/ConnectorObject';
import { StrokeObject } from '../objects/StrokeObject';
import { ImageObject } from '../objects/ImageObject';
import { DropHighlight } from '../images/DropHighlight';
import { useImageInsert, IMAGE_PICKER_ACCEPT } from '../images/useImageInsert';
import { Toast } from '../ui/Toast';
import { VISITOR_ID } from '../sync/identity';
import { useShapeTool } from '../tools/useShapeTool';
import { useConnectorTool } from '../tools/useConnectorTool';
import { usePenTool } from '../tools/usePenTool';
import { usePenOptions } from '../tools/usePenOptions';
import { useConnectorEndDrag } from '../tools/useConnectorEndDrag';
import { ShapePreview } from '../tools/ShapeTool';
import { PenPreview } from '../tools/PenTool';
import { ConnectorOverlay } from '../tools/ConnectorTool';
import type { ShapeKind } from '../../shared/config';
import type { ConnectionState } from '../sync/connectBoard';
import { createSticky, deleteObjects, objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { createText, setTextSize, setTextWidthAuto, setTextWidthFixed } from '../../shared/objects/text';
import { createCanvasMeasurer, type Measurer } from '../objects/textLayout';
import { remeasureTextBox } from '../objects/useTextBoxSync';
import type { TextSize, TextWidthMode } from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import { reportConnectionState, setOutageHandler, setSeedNotesHandler } from '../canvas/testHooks';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { WebsocketProvider } from 'y-websocket';
import { worldToScreen } from '../canvas/camera';

export interface BoardProps {
  /**
   * Test seam: hands the board's Y.Doc to the caller once, so component
   * tests can create and delete notes through the model while the app keeps
   * rendering them. Unused by the app itself.
   */
  onDocReady?(doc: Y.Doc): void;
  /**
   * The board to open, instead of the one the address names. Only a test needs
   * it: two component tests on one page would otherwise share a board.
   */
  boardId?: string;
  /**
   * Test seam (story 4, TC-23): the live provider, so a component test can
   * emit a close event and drive the app into `load_failed`.
   */
  onProviderReady?(provider: WebsocketProvider): void;
}

/**
 * Whether the board can be edited from a connection state. False only for
 * `load_failed` — a board whose stored state could not be read must not be
 * written, because what a person would be editing is not what is really there.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * Top-level layout and wiring. The camera lives in useCamera (story 1); the
 * notes live in a Y.Doc owned by useBoardDoc (stories 3 and 4 will sync and
 * persist that same document); which notes are selected or edited is local
 * interaction state and is never written to the document.
 */
export function Board(props: BoardProps = {}): JSX.Element {
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const cam = useCamera(viewport);
  const { camera } = cam;
  const [boardId] = useState(() => props.boardId ?? newBoardId());

  const { doc, objects, connection, emulateOutage } = useBoardDoc(boardId, props.onProviderReady);
  const selection = useSelection(objects);

  const editable = canEdit(connection);

  // The picture flow (story 12): the three ways a file arrives, the placeholder it
  // leaves on the board, and the upload that turns it into a picture. It is given
  // the camera and the board's size because where a dropped picture goes is decided
  // by where it was dropped, and a pasted one by what this person is looking at.
  const images = useImageInsert({
    doc,
    boardId,
    camera,
    viewport,
    connection,
    identityId: VISITOR_ID,
  });

  // This person's own undo history, for as long as this board is open: created
  // with its document and thrown away with it, so a reload begins empty again.
  const undoController = useUndoController(doc);
  const undo = useUndo(undoController, editable);

  // The measurer the board writes a text object's box back with, once for this
  // board: the box is stored, so whoever changed the text measures it.
  const textMeasureRef = useRef<Measurer | null>(null);
  if (textMeasureRef.current === null) textMeasureRef.current = createCanvasMeasurer();
  const textMeasure = textMeasureRef.current;

  // The tool keys are a listener of their own, so an object's own editor keeps
  // the keys it has always had: 'v', 't' and 'n' typed into a text object are
  // letters, not shortcuts. N creates a sticky note, which is what it did before
  // there were any tools, and the callback is called at the key press rather than
  // passed in, because the board is not wired up yet at this line. I asks for a
  // picture, and does the same thing the Image button does. Both of them are asked
  // whether the page is in the middle of writing text first, and stand down when it
  // is — see useToolKeys.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const { tool, setTool, shapeKind, setShapeKind } = useToolKeys(
    editable,
    () => {
      createStickyAtViewportCentre();
    },
    () => {
      images.openPicker();
    },
    () => selectionRef.current.editingId !== null,
  );

  // A test build lets the test take this board's link down.
  useEffect(() => {
    setOutageHandler((ms: number) => emulateOutage(ms));
  }, [emulateOutage]);

  // The connection state a test can read as well as see.
  useEffect(() => {
    reportConnectionState(connection);
  }, [connection]);

  // The board renders objects in stable order (by id) so CSS z-index does the
  // stacking. Reordering keyed children would move the dragged object's DOM node
  // out of the document, which drops pointer capture and kills the drag.
  const rendered = useMemo(() => [...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), [objects]);

  const { onDocReady } = props;
  useEffect(() => {
    if (onDocReady !== undefined) onDocReady(doc);
  }, [doc, onDocReady]);

  // A test build can fill this board to its tested size in one transaction.
  useEffect(() => {
    setSeedNotesHandler((count: number) => {
      const stride = 260;
      const columns = Math.ceil(Math.sqrt(count));
      doc.transact(() => {
        for (let i = 0; i < count; i++) {
          createSticky(doc, { x: (i % columns) * stride, y: Math.floor(i / columns) * stride });
        }
      });
    });
  }, [doc]);
  /** Create something at a world point and start typing straight away. What it
   * is comes from the tool the board is in unless the caller says: a sticky note
   * in Select, a text object in the Text tool — and the board is back in Select
   * afterwards, because a tool that stayed on would be a tool the person has to
   * remember to leave. */
  const createAt = (world: Point, kind?: 'sticky' | 'text'): void => {
    if (!editable) return;
    const making = kind ?? (tool === 'text' ? 'text' : 'sticky');
    // Its own undo step, on both sides: neither the action before it nor the
    // first drag of the new object is merged into the act of creating it.
    undoController.boundary();
    const id = making === 'text' ? createText(doc, world) : createSticky(doc, world);
    undoController.boundary();
    if (making === 'text') {
      setTool('select');
      // The empty object shows the box it was measured into, which is also what
      // its first line of text will be laid out in.
      if (id !== null && id !== '') remeasureTextBox(doc, id, textMeasure);
    }
    if (id !== null && id !== '') selection.startEdit(id);
  };

  /** N: a sticky note at the centre of what is on screen, whatever tool the board
   * is in — the key says what to make, not what tool to be in. */
  const createStickyAtViewportCentre = (): void => {
    createAt(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }), 'sticky');
  };

  // Marquee selection
  const marqueeSelect = useCallback((ids: string[]) => {
    if (ids.length > 0) {
      selection.setMany(ids, true);
    }
  }, [selection]);

  const marqueeObjectsInRect = useCallback((rect: Rect): string[] => {
    return objectsInRect(objects, rect);
  }, [objects]);

  const marquee = useMarquee(camera, marqueeSelect, marqueeObjectsInRect);

  // Transform gesture (group move + resize handles). Both ends of a gesture
  // close an undo step, so the whole drag — every frame of it, and the
  // bring-to-front that came with it — is one thing to undo, and a gesture that
  // was cancelled is still exactly one.
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: () => {
      undoController.boundary();
    },
    onGestureEnd: () => {
      undoController.boundary();
    },
  });

  // Board-wide keyboard commands (select all, clear, nudge, delete, undo, redo)
  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    undo: undoController,
  });

  // Enter key to edit the single selected sticky.
  // The selection is read through the ref above, so the keydown handler installed
  // here once always sees the latest one.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const sel = selectionRef.current;
      if (e.key === 'Enter') {
        const isText = e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement ||
          (e.target instanceof HTMLElement && e.target.isContentEditable);
        if (isText || sel.editingId !== null) return;
        if (sel.ids.size !== 1) return;
        const [onlyId] = sel.ids;
        e.preventDefault();
        sel.startEdit(onlyId);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The object the text toolbar is for: the selection's only member, when that
  // one object is a text object. Everything else about the selection is generic.
  /** What the board does with a thing it has just drawn: the new shape or arrow
   * is the one thing selected, and the board is back in Select, because a tool
   * that stayed armed after every drawing would be a tool a person has to
   * remember to leave before they could move what they made. */
  const created = useCallback(
    (id: string) => {
      setTool('select');
      selection.setMany([id], false);
    },
    [selection, setTool],
  );

  // The Shape tool and the Connector tool own their own drag, on the window and
  // in the capturing phase, and are switched on by the tool the board is in. They
  // are given the camera they were drawn with and the objects that are there now,
  // and they are handed nothing else to write with but the model.
  const shapeTool = useShapeTool({
    doc,
    camera,
    active: tool === 'shape' && editable,
    canEdit: editable,
    kind: shapeKind,
    undo: undoController,
    onCreated: created,
  });

  const connectorTool = useConnectorTool({
    doc,
    camera,
    objects,
    active: tool === 'connector' && editable,
    canEdit: editable,
    undo: undoController,
    onCreated: created,
  });

  // Which pen the next stroke is drawn with: this person's, for this page, written
  // nowhere and never sent to anybody. Choosing a colour or a width restyles no stroke
  // that is already on the board, because a stroke keeps the pen it was drawn with in
  // its own record.
  const pen = usePenOptions();

  // The Pen tool owns its drag on the window, in the capturing phase, like the other
  // two drawing tools — which is also the whole of why a pen drag neither pans the
  // board nor moves the note it starts on. It is the one tool that is *not* handed
  // `created`: a finished stroke leaves the board in the Pen tool, because the next
  // thing a person holding a pen does is draw the next line, and a pen that put itself
  // away after every stroke would be a pen that had to be found again.
  const penTool = usePenTool({
    doc,
    camera,
    active: tool === 'pen' && editable,
    canEdit: editable,
    color: pen.color,
    thickness: pen.thickness,
    undo: undoController,
  });

  // The two ends of a selected arrow can be dragged to another shape, or loose
  // into the air; the handles are the selection's, the gesture is this.
  const endDrag = useConnectorEndDrag({
    doc,
    camera,
    objects,
    canEdit: editable,
    undo: undoController,
  });

  /** The one object selected, which is what a floating toolbar belongs to. */
  const onlySelected = selection.ids.size === 1 ? objects.find((o) => selection.ids.has(o.id)) : undefined;
  const onlyText = onlySelected !== undefined && onlySelected.type === 'text' ? onlySelected : undefined;
  /** The shape the arrow being drawn would touch: the one whose four sides are
   * being offered as the place it would fasten to — whether the arrow is being
   * drawn for the first time or one of its ends is being moved. */
  const hoverId = connectorTool.hoverId ?? (connectorTool.drag === null ? endDrag.drag?.targetId ?? null : null);
  const attachTarget = hoverId === null ? null : objects.find((o) => o.id === hoverId) ?? null;
  /** The one arrow the selection holds, whose two ends are the only handles it has. */
  const onlyConnector = onlySelected !== undefined && onlySelected.type === 'connector' ? onlySelected : null;

  /** Board units to the pixels a preview is drawn in. */
  const toScreen = (point: Point): Point => worldToScreen(camera, point);

  /** One press of the text toolbar is one step of mine, and it takes the box the
   * new size or width needs with it: one Undo returns the text, its size and its
   * lines together. */
  const editText = (write: () => void): void => {
    if (!editable || onlyText === undefined) return;
    undoController.boundary();
    write();
    remeasureTextBox(doc, onlyText.id, textMeasure);
    undoController.boundary();
  };

  /** Remove is the Delete key's delete, from a button: one step of this person's
   * own history, the same object gone out of the document, and the selection left
   * holding whatever else was in it. It is offered for a picture whose bytes never
   * arrived because it is the only thing still worth doing about one. */
  const removeImage = (id: string): void => {
    if (!editable) return;
    undoController.boundary();
    deleteObjects(doc, [id]);
    undoController.boundary();
    selection.setMany(
      [...selection.ids].filter((selected) => selected !== id),
      false,
    );
  };

  return (
    <div className="app">
      <BoardViewport
        camera={camera}
        onViewportSize={setViewport}
        onBeginPan={cam.beginPan}
        onPanMove={cam.panMove}
        onEndPan={cam.endPan}
        onWheel={cam.wheel}
        onZoomAtPoint={cam.zoomAtPoint}
        onZoomStep={cam.zoomStep}
        onReset={cam.reset}
        onEmptyDblClick={(point) => {
          createAt(screenToWorld(camera, point));
        }}
        onTextToolClick={(point) => {
          // The Text tool's one job: this point becomes a text object, and the
          // board is back in Select afterwards (createAt says which of the two it
          // makes, from the tool it was called in).
          createAt(screenToWorld(camera, point));
        }}
        onEmptyClick={() => {
          selection.clear();
        }}
        onMarqueeBegin={(p) => marquee.begin(p)}
        onMarqueeMove={(p) => marquee.move(p)}
        onMarqueeEnd={() => marquee.end()}
        onMarqueeCancel={() => marquee.cancel()}
        // Files dragged over and dropped on the board. The highlight, the refusal
        // and the picture are all the insert flow's business; this is the part of
        // it which knows where the board is on the screen.
        onFilesDragEnter={images.onDragEnter}
        onFilesDragOver={images.onDragOver}
        onFilesDragLeave={images.onDragLeave}
        onFilesDrop={images.onDrop}
        cursor={
          !editable
            ? 'default'
            : tool === 'text'
              ? 'text'
              : tool === 'shape' || tool === 'connector' || tool === 'pen'
                ? 'crosshair'
                : 'default'
        }
      >
        {rendered.map((object) => {
          // The two kinds of object are selected, edited, dragged and undone the
          // same way; only the component and the name of its prop differ.
          const common = {
            doc,
            zoom: camera.zoom,
            selected: selection.ids.has(object.id),
            editing: object.id === selection.editingId,
            canEdit: editable,
            onSelect: (id: string) => {
              selection.click(id);
            },
            onToggle: (id: string) => {
              selection.toggle(id);
            },
            onStartEdit: (id: string) => {
              selection.startEdit(id);
            },
            onEndEdit: (next: 'selected' | 'unselected') => {
              selection.endEdit(next);
            },
            onGesturePointerDown: (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
              gesture.onObjectPointerDown(e, id);
            },
            onGesturePointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
              gesture.onPointerMove(e);
            },
            onGesturePointerUp: (e: ReactPointerEvent<HTMLDivElement>) => {
              gesture.onPointerUp(e);
            },
            onGesturePointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => {
              gesture.onPointerCancel(e);
            },
            undo: undoController,
          };
          if (object.type === 'text') return <TextObject key={object.id} obj={object} {...common} />;
          if (object.type === 'shape') return <ShapeObject key={object.id} obj={object} {...common} />;
          if (object.type === 'connector') {
            // An arrow is drawn between two points rather than painted into a box,
            // and it is selected, dragged and deleted like anything else; it has
            // nothing to type into, so the editor's half of `common` goes unused.
            return <ConnectorObject key={object.id} obj={object} {...common} />;
          }
          if (object.type === 'stroke') {
            // A drawing is the third of those: painted into a box, selected by its
            // line rather than by that box, and with nothing in it to type.
            return <StrokeObject key={object.id} obj={object} {...common} />;
          }
          if (object.type === 'image') {
            // A picture is selected, dragged, resized and deleted by the same
            // machinery as all of those; what it has that they have not is a state
            // about where its bytes are, and about whether the upload of this one is
            // happening in this tab rather than in somebody else's.
            return (
              <ImageObject
                key={object.id}
                object={object}
                {...common}
                progress={images.progress.get(object.id)}
                canRetry={images.canRetry(object.id)}
                onRetry={(id: string) => {
                  images.retry(id);
                }}
                onRemove={(id: string) => {
                  removeImage(id);
                }}
              />
            );
          }
          if (object.type === 'sticky') return <StickyNote key={object.id} note={object} {...common} />;
          return null;
        })}
      </BoardViewport>
      <MarqueeRect rect={marquee.rect} camera={camera} />
      <ShapePreview rect={shapeTool.preview} />
      <PenPreview
        points={penTool.preview}
        // The pen the stroke is being drawn with, which is the one that was in hand
        // when the pointer went down: the line on the screen is the line that will be
        // saved, and a preview that recoloured halfway across a drag was a preview
        // that lied about the stroke it was promising.
        color={penTool.previewPen?.color ?? pen.color}
        thickness={penTool.previewPen?.thickness ?? pen.thickness}
        camera={camera}
      />
      <ConnectorOverlay
        target={attachTarget}
        drag={connectorTool.drag ?? endDrag.drag}
        worldToScreen={toScreen}
      />
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={camera}
        onHandlePointerDown={(e, h) => gesture.onHandlePointerDown(e, h)}
        onHandlePointerMove={(e) => gesture.onPointerMove(e)}
        onHandlePointerUp={(e) => gesture.onPointerUp(e)}
        onHandlePointerCancel={(e) => gesture.onPointerCancel(e)}
        connectorEnds={
          onlyConnector === null
            ? null
            : { id: onlyConnector.id, from: onlyConnector.resolved.from, to: onlyConnector.resolved.to }
        }
        onEndPointerDown={(e, id, end) => endDrag.onEndPointerDown(e, id, end)}
        onEndPointerMove={(e) => endDrag.onEndPointerMove(e)}
        onEndPointerUp={(e) => endDrag.onEndPointerUp(e)}
        onEndPointerCancel={(e) => endDrag.onEndPointerCancel(e)}
      />
      <Toolbar
        onCreateSticky={createStickyAtViewportCentre}
        onAddImages={() => {
          images.openPicker();
        }}
        tool={tool}
        onSelectTool={setTool}
        shapeKind={shapeKind}
        onSelectShapeKind={setShapeKind}
        penColor={pen.color}
        penThickness={pen.thickness}
        onSelectPenColor={pen.setColor}
        onSelectPenThickness={pen.setThickness}
        disabled={!editable}
        undo={undo}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={objects}
        onTextSize={(size: TextSize) => {
          editText(() => {
            if (onlyText !== undefined) setTextSize(doc, onlyText.id, size);
          });
        }}
        onTextMode={(mode: TextWidthMode) => {
          editText(() => {
            if (onlyText === undefined) return;
            // 'Fixed' keeps the width the text has earned and takes over the
            // height; 'auto' hands the width back to the text, and the
            // measurement that follows decides it again.
            if (mode === 'fixed') setTextWidthFixed(doc, onlyText.id, onlyText.width);
            else setTextWidthAuto(doc, onlyText.id);
          });
        }}
        onDelete={() => {
          if (!editable) return;
          // One step of mine, closed on both sides of it.
          undoController.boundary();
          deleteObjects(doc, [...selection.ids]);
          undoController.boundary();
          selection.clear();
        }}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
      <ConnectionStatus state={connection} />
      {/* The board while files are being dragged over it, and the file dialogue the
          Image button and the I key open. The input is the operating system's and
          not the board's: it is where a file comes from, and it says nothing about
          the board to anybody. */}
      <DropHighlight dragging={images.dragging} />
      <input
        ref={images.fileInputRef}
        type="file"
        accept={IMAGE_PICKER_ACCEPT}
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="image-file-input"
        data-testid="image-file-input"
        onChange={(e) => {
          const picked = e.currentTarget.files === null ? [] : Array.from(e.currentTarget.files);
          // Answered and cleared at once, so choosing the same file twice is two
          // additions rather than a silence the second time.
          e.currentTarget.value = '';
          images.onPickedFiles(picked);
        }}
      />
      {/* The refusals, in words nobody has to dig out of a console. */}
      <Toast />
    </div>
  );
}
