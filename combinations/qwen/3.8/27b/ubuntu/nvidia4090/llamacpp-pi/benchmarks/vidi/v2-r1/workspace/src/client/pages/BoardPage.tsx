// Board page (story 5, share.pages): checks that the board in the URL
// exists before mounting the stories 1–4 board, with the loading, not-found
// and unreachable states around it. The stories 1–4 board UI (formerly the
// body of App.tsx) mounts only in the `ready` state.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from 'react';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Point,
  type Size,
} from '../canvas/camera';
import { useCamera } from '../canvas/useCamera';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useBoardKeys } from '../board/useBoardKeys';
import { useTransformGesture } from '../board/useTransformGesture';
import { createUndo } from '../board/undo';
import { useUndo } from '../board/useUndo';
import { UndoButtons } from '../board/UndoButtons';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { SelectionBar } from '../board/SelectionBar';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { Toolbar } from '../board/Toolbar';
import { useActiveTool } from '../tools/useActiveTool';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { PenTool } from '../tools/PenTool';
import { PenToolbar } from '../tools/PenToolbar';
import { usePenOptions } from '../tools/usePenOptions';
import { getObjectType } from '../objects/registry';
import { ShapeToolbar } from '../objects/ShapeToolbar';
import { useImageInsert } from '../images/useImageInsert';
import { DropHighlight } from '../images/DropHighlight';
import { Toast } from '../ui/Toast';
import { createShape, getShapeLabel, setShapeStyle } from '../../shared/objects/shape';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import {
  createSticky,
  deleteObject,
  deleteObjects,
  getStickyText,
  objectBounds,
  objectsSnapshot,
  setStickyColor,
  snapshot,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { createText, setTextSize } from '../../shared/objects/text';
import { createConnector, parseEndpoint } from '../../shared/objects/connector';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  TEXT_SIZES,
  type TextSize,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';
import { getClientId } from '../client-id';
import {
  IMAGE_ACCEPTED_TYPES,
  STICKY_COLORS,
  type StickyColor,
} from '../../shared/config';
import { isValidBoardId } from '../../shared/board-id';
import { isTestMode, type Vidi6TestHooks } from '../testHooks';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../App';
import { checkBoard } from '../api';
import { SharePanel } from '../share/SharePanel';
import { nextBoardPageState, type BoardPageState } from './state';
import { NotFoundPage } from './NotFoundPage';

/** Gap (screen px) between the note top edge and the note toolbar. */
const NOTE_TOOLBAR_GAP_PX = 8;

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function BoardPage(props: { id: string }): JSX.Element {
  const { id } = props;
  // Malformed codes go straight to not found without any request
  // (share.not_found). Everything else starts with a check.
  const [state, setState] = useState<BoardPageState>(() =>
    isValidBoardId(id) ? { kind: 'checking' } : { kind: 'not_found' },
  );
  const attemptRef = useRef(0);

  // Initial check on mount (and when the id changes).
  useEffect(() => {
    if (!isValidBoardId(id)) {
      setState({ kind: 'not_found' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'checking' });
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    void checkBoard(id).then((result) => {
      if (cancelled) return;
      setState((prev) => {
        if (result.kind === 'exists') return { kind: 'ready', boardId: id };
        return nextBoardPageState(prev, result, attempt);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Retry while unreachable, with backoff. The timer is cleared on unmount
  // and as soon as the state settles (ready / not_found), and the board then
  // opens — or Board not found is shown — without a reload (share.unreachable).
  useEffect(() => {
    if (state.kind !== 'unreachable') return;
    const timer = setTimeout(() => {
      attemptRef.current += 1;
      const attempt = attemptRef.current;
      void checkBoard(id).then((result) => {
        setState((prev) => {
          if (result.kind === 'exists') return { kind: 'ready', boardId: id };
          return nextBoardPageState(prev, result, attempt);
        });
      });
    }, state.nextRetryMs);
    return () => clearTimeout(timer);
  }, [state, id]);

  switch (state.kind) {
    case 'checking':
      return (
        <div className="board-opening" role="status" data-testid="board-opening">
          Opening board…
        </div>
      );
    case 'unreachable':
      return (
        <div className="board-unreachable" role="status" data-testid="board-unreachable">
          Couldn't reach vidi6. Retrying…
        </div>
      );
    case 'not_found':
      return <NotFoundPage />;
    case 'ready':
      return <Board boardId={id} />;
  }
}

/** The stories 1–7 board, mounted only once the board is known to exist. */
function Board(props: { boardId: string }): JSX.Element {
  const boardId = props.boardId;
  const { doc, objects, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(objects);
  const editable = canEdit(connectionState);
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  // Viewport size from the root element; camera x,y are unchanged on resize.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setSize((s) =>
          s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height },
        );
      }
    };
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, []);

  const cam = useCamera(size);

  // Story 12 (image.insert): image drop / paste / picker, upload progress
  // and retry. The identity is this tab's anonymous client id.
  const identityId = useMemo(() => getClientId(), []);
  const images = useImageInsert({
    doc,
    boardId,
    camera: cam.camera,
    connection: connectionState,
    identityId,
  });

  // The `now` the image display states are derived from: re-rendered every
  // 30 s while any image is uploading so an abandoned upload becomes
  // "unfinished" without further activity (image.unfinished).
  const [now, setNow] = useState<number>(() => Date.now());
  const anyImageUploading = useMemo(
    () => objects.some((o) => o.type === 'image' && o.status === 'uploading'),
    [objects],
  );
  useEffect(() => {
    if (!anyImageUploading) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [anyImageUploading]);

  // Story 12 (image.drop): the drop highlight while image files are dragged
  // over the board. dragenter/dragleave nest, so track a depth.
  const [dropActive, setDropActive] = useState(false);
  const dragDepth = useRef(0);
  const dragHasFiles = (e: DragEvent): boolean =>
    e.dataTransfer !== null && Array.from(e.dataTransfer.types).includes('Files');
  const onRootDragEnter = (e: React.DragEvent): void => {
    if (!dragHasFiles(e.nativeEvent)) return;
    dragDepth.current += 1;
    setDropActive(true);
  };
  const onRootDragOver = (e: React.DragEvent): void => {
    if (!dragHasFiles(e.nativeEvent)) return;
    images.onDragOver(e.nativeEvent);
  };
  const onRootDragLeave = (e: React.DragEvent): void => {
    if (!dragHasFiles(e.nativeEvent)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropActive(false);
  };
  const onRootDrop = (e: React.DragEvent): void => {
    if (!dragHasFiles(e.nativeEvent)) return;
    dragDepth.current = 0;
    setDropActive(false);
    images.onDrop(e.nativeEvent);
  };

  // Story 9 (tool.shortcuts) + story 10 (tools.active_tool): the active
  // tool (Select / Text / Shape / Connector) and the single-letter
  // shortcuts. N creates a sticky at the view centre, the same action as
  // the toolbar's Sticky note (N) button.
  const {
    tool,
    shapeKind,
    setTool,
    setShapeKind,
    toolCreated,
  } = useActiveTool({
    canEdit: editable,
    isEditing: () => selection.editingId !== null,
    onSelect: (id) => selection.selectOnly(id),
    onCreateStickyAtCenter: () => createStickyAt({ x: size.width / 2, y: size.height / 2 }),
    // Story 12 (image.pick): the I key and the Image button open the file
    // picker; it is an action, not a tool change.
    onOpenImagePicker: () => images.openPicker(),
  });

  // Story 11 (pen.options): the pen's session-only colour/thickness choice;
  // it survives tool switches for the life of the mounted board.
  const penOptions = usePenOptions();

  // Story 8: one undo controller per board doc (undo.history); it is
  // destroyed when the board unmounts, so a fresh board (or reload) starts
  // with empty history (undo.session_only).
  const undo = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => {
    return () => undo.destroy();
  }, [undo]);
  const undoApi = useUndo(undo, editable);

  // Story 12: Remove on a failed / unfinished image (one undo step), and
  // drop the in-memory file so Retry no longer offers it.
  const removeImage = useCallback(
    (imageId: string) => {
      if (!editable) return;
      undo.boundary();
      deleteObject(doc, imageId);
      undo.boundary();
      images.forget(imageId);
    },
    [doc, editable, images, undo],
  );

  // Story 7: the generic transform gesture (group move + bounding-box resize)
  // and the selection keyboard commands. Story 8: the gesture's start and
  // end are undo boundaries, so all of a drag's frame writes merge into one
  // step and never bleed into the surrounding actions (undo.boundaries).
  const gesture = useTransformGesture({
    doc,
    camera: cam.camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: () => undo.boundary(),
    onGestureEnd: () => undo.boundary(),
  });
  useBoardKeys({ doc, selection, snapshot: objects, canEdit: editable, undo });

  // Shift+drag marquee: on release, the fully-inside ids join the selection.
  const marquee = useMarquee(cam.camera, objects, (ids) => selection.setMany(ids, true));

  // Story 10: the world boxes of every object, for the connectors'
  // endpoint resolution (connector.follow).
  const rects = useMemo(
    () => new Map(objects.map((o) => [o.id, objectBounds(o)] as const)),
    [objects],
  );

  const createStickyAt = useCallback(
    (screen: Point) => {
      if (!editable) return; // story 4: edit lock
      const world = screenToWorld(cam.camera, screen);
      // Story 8: one creation is one undo step, separate from whatever
      // happened before (and after) it (undo.boundaries).
      undo.boundary();
      const id = createSticky(doc, world);
      undo.boundary();
      if (id) {
        // The new note is selected and starts editing immediately (the
        // 'edit' action accepts ids that are not in the snapshot yet), so
        // typed characters go straight into it.
        selection.startEdit(id);
      }
    },
    [cam.camera, doc, editable, selection, undo],
  );

  const deleteSelection = useCallback(() => {
    if (!editable || selection.ids.size === 0) return;
    // Story 8: one delete (of any number of objects) is one undo step.
    undo.boundary();
    deleteObjects(doc, [...selection.ids]);
    undo.boundary();
    selection.clear();
  }, [doc, selection, editable, undo]);

  // Story 9 (tool.text): a click anywhere on the board creates a text object
  // with its top-left at the click point, switches back to the Select tool
  // and starts editing it immediately.
  const createTextAt = useCallback(
    (screen: Point) => {
      if (!editable) return; // story 4: edit lock
      const world = screenToWorld(cam.camera, screen);
      // Story 8: one creation is one undo step.
      undo.boundary();
      const id = createText(doc, world, getClientId());
      undo.boundary();
      if (id) {
        setTool('select');
        selection.startEdit(id);
      }
    },
    [cam.camera, doc, editable, selection, setTool, undo],
  );

  // Test hooks (test mode only).
  useEffect(() => {
    if (!isTestMode()) return;
    const hooks: Vidi6TestHooks = {
      doc,
      getCamera: () => cam.camera,
      setCamera: (c) => cam.setCamera(c),
      getNotes: () =>
        snapshot(doc).map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          color: n.color,
          text: n.text,
          z: n.z,
        })),
      getObjects: () =>
        objectsSnapshot(doc).map((o) => {
          const b = objectBounds(o);
          const ep = (e: unknown) => {
            const p = parseEndpoint(e);
            if (p === null) return undefined;
            return p.kind === 'free'
              ? { kind: 'free' as const, x: p.x, y: p.y }
              : { kind: 'attached' as const, objectId: p.objectId };
          };
          return {
            id: o.id,
            type: o.type,
            x: o.x,
            y: o.y,
            width: b.width,
            height: b.height,
            color: o.color,
            text: o.text,
            z: o.z,
            size: o.size,
            widthMode: o.widthMode,
            kind: o.kind,
            fill: o.fill,
            stroke: o.stroke,
            label: o.label,
            fromPoint: o.fromPoint,
            toPoint: o.toPoint,
            from: o.from !== undefined ? ep(o.from) : undefined,
            to: o.to !== undefined ? ep(o.to) : undefined,
            points: o.points !== undefined ? [...o.points] : undefined,
            baseWidth: o.baseWidth,
            baseHeight: o.baseHeight,
            thickness: o.thickness,
          };
        }),
      getConnectionState: () => connectionState,
      createNote: () => {
        createStickyAt({ x: size.width / 2, y: size.height / 2 });
      },
      createNoteAt: (x, y, color, text) => {
        const stickyColor: StickyColor | undefined =
          Object.keys(STICKY_COLORS).includes(color) ? (color as StickyColor) : undefined;
        // Story 8: one creation is one undo step (as through the UI).
        undo.boundary();
        const id = createSticky(doc, { x, y }, stickyColor);
        if (id !== null && text !== undefined && text !== '') {
          getStickyText(doc, id)?.insert(0, text);
        }
        undo.boundary();
        return id;
      },
      createShape: (a) => {
        undo.boundary();
        const id = createShape(doc, a, 'seed');
        undo.boundary();
        return id;
      },
      setShapeLabel: (id, text) => {
        const t = getShapeLabel(doc, id);
        if (t === undefined) return;
        t.delete(0, t.length);
        t.insert(0, text.slice(0, SHAPE_LABEL_MAX_CHARS));
      },
      createConnector: (from, to) => {
        // Attached endpoints store a fallback point (their target's centre) so
        // a deleted target leaves a free end at a sensible spot.
        const byId = new Map(objectsSnapshot(doc).map((o) => [o.id, o]));
        const ep = (e: { kind: 'free'; x: number; y: number } | { kind: 'attached'; objectId: string }) => {
          if (e.kind === 'free') return { kind: 'free' as const, x: e.x, y: e.y };
          const target = byId.get(e.objectId);
          const fallback = target
            ? {
                x: target.x + objectBounds(target).width / 2,
                y: target.y + objectBounds(target).height / 2,
              }
            : { x: 0, y: 0 };
          return { kind: 'attached' as const, objectId: e.objectId, fallback };
        };
        undo.boundary();
        const id = createConnector(doc, ep(from), ep(to), 'seed');
        undo.boundary();
        return id;
      },
      undo: () => undo.undo(),
      redo: () => undo.redo(),
      boundary: () => undo.boundary(),
      canUndo: () => undo.canUndo(),
      canRedo: () => undo.canRedo(),
    };
    window.__vidi6 = hooks;
    return () => {
      delete window.__vidi6;
    };
  }, [doc, cam.camera, cam.setCamera, connectionState, size, createStickyAt, undo]);

  // Objects of a known type render through their registry component, in a
  // stable DOM order (by id); visual stacking comes from each object's CSS
  // z-index. Reordering the DOM when z changes would move the element of an
  // in-flight drag and break its pointer capture, so DOM order never follows z.
  const objectsById = [...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // With exactly one sticky selected, the story 2 NoteToolbar (colours +
  // delete) replaces the multi-selection bar (sel.bar).
  const selectedObjects = objects.filter((o) => selection.ids.has(o.id));
  const singleSticky: ObjectSnapshot | null =
    selectedObjects.length === 1 && selectedObjects[0].type === 'sticky'
      ? selectedObjects[0]
      : null;
  const noteToolbarVisible =
    singleSticky !== null && selection.editingId !== singleSticky.id;

  // With exactly one text object selected, the story 9 TextToolbar (size
  // presets + delete) replaces the multi-selection bar (text.sizes).
  const singleText: ObjectSnapshot | null =
    selectedObjects.length === 1 && selectedObjects[0].type === 'text'
      ? selectedObjects[0]
      : null;
  const textToolbarVisible =
    singleText !== null && selection.editingId !== singleText.id;
  const singleStickyColor: StickyColor =
    typeof singleSticky?.color === 'string' && singleSticky.color in STICKY_COLORS
      ? (singleSticky.color as StickyColor)
      : ('yellow' as StickyColor);

  // With exactly one shape selected (and not being edited), the story 10
  // ShapeToolbar (fill + outline swatches) replaces the multi-selection bar
  // (shape.style).
  const singleShape: ObjectSnapshot | null =
    selectedObjects.length === 1 && selectedObjects[0].type === 'shape'
      ? selectedObjects[0]
      : null;
  const shapeToolbarVisible =
    singleShape !== null &&
    editable &&
    selection.editingId !== singleShape.id;
  const singleShapeFill: FillColor =
    typeof singleShape?.fill === 'string' && singleShape.fill in SHAPE_FILL_COLORS
      ? (singleShape.fill as FillColor)
      : DEFAULT_SHAPE_FILL;
  const singleShapeStroke: StrokeColor =
    typeof singleShape?.stroke === 'string' && singleShape.stroke in SHAPE_STROKE_COLORS
      ? (singleShape.stroke as StrokeColor)
      : DEFAULT_SHAPE_STROKE;

  return (
    <div
      ref={rootRef}
      className="board-root"
      data-testid="board-root"
      onDragEnter={onRootDragEnter}
      onDragOver={onRootDragOver}
      onDragLeave={onRootDragLeave}
      onDrop={onRootDrop}
    >
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cam.camera}
        size={size}
        onBeginPan={cam.beginPan}
        onPanMove={cam.panMove}
        onEndPan={cam.endPan}
        onWheel={cam.wheel}
        onZoomStep={cam.zoomStep}
        onReset={cam.reset}
        onCreateStickyAt={createStickyAt}
        onEmptyClick={() => selection.clear()}
        marquee={marquee}
        textTool={tool === 'text' ? { onClickAt: createTextAt } : null}
      >
        {objectsById.map((obj) => {
          const spec = getObjectType(obj.type);
          if (!spec) return null; // unknown type: in the doc, not on screen
          const Component = spec.Component;
          return (
            <Component
              key={obj.id}
              obj={obj}
              doc={doc}
              zoom={cam.camera.zoom}
              selected={selection.ids.has(obj.id)}
              editing={selection.editingId === obj.id}
              canEdit={editable}
              onPointerDown={gesture.onObjectPointerDown}
              onStartEdit={(id: string) => {
                if (editable) selection.startEdit(id); // story 4: edit lock
              }}
              onEndEdit={(next) => {
                // 'selected' keeps the selection (Escape); 'unselected' clears
                // it (click outside — the editor's outside-pointerdown).
                if (next === 'unselected') selection.clear();
                else selection.endEdit();
              }}
              undo={undo}
              camera={cam.camera}
              rects={rects}
              snapshot={objects}
              imageCtx={
                obj.type === 'image'
                  ? {
                      isUploader: obj.uploaderId === identityId,
                      progress: images.progress.get(obj.id),
                      canRetry: images.canRetry(obj.id),
                      now,
                      onRetry: (imageId: string) => {
                        if (editable) images.retry(imageId);
                      },
                      onRemove: (imageId: string) => removeImage(imageId),
                    }
                  : undefined
              }
            />
          );
        })}
      </BoardViewport>

      <MarqueeRect rect={marquee.rect} camera={cam.camera} />
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={cam.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <SelectionBar ids={selection.ids} snapshot={objects} onDelete={deleteSelection} />

      <Toolbar
        tool={tool}
        shapeKind={shapeKind}
        onSelectTool={setTool}
        onSelectShapeKind={setShapeKind}
        disabled={!editable}
        onCreateSticky={() => createStickyAt({ x: size.width / 2, y: size.height / 2 })}
        onOpenImage={() => images.openPicker()}
        extra={<UndoButtons undo={undoApi} />}
      />

      {/* Story 12: the file picker input (hidden; opened by the Image
          button / I key) and the toast stack for rejection messages. */}
      <input
        ref={images.pickerInputRef}
        type="file"
        accept={IMAGE_ACCEPTED_TYPES.join(',')}
        multiple
        data-testid="image-picker"
        style={{ display: 'none' }}
        onChange={(e) => images.onPickerChange(e)}
      />
      <div className="toast-stack" data-testid="toast-stack">
        {images.toasts.map((message) => (
          <Toast key={message} message={message} />
        ))}
      </div>
      <DropHighlight visible={dropActive} />

      {/* Story 10: the shape and connector tools are mounted only while
          active; unmounting drops any unfinished drag without creating
          anything (tools.return_to_select). */}
      {tool === 'shape' && editable && (
        <ShapeTool
          kind={shapeKind}
          camera={cam.camera}
          doc={doc}
          canEdit={editable}
          undo={undo}
          onCreated={toolCreated}
        />
      )}
      {tool === 'connector' && editable && (
        <ConnectorTool
          camera={cam.camera}
          snapshot={objects}
          doc={doc}
          canEdit={editable}
          undo={undo}
          onCreated={toolCreated}
        />
      )}

      {/* Story 11: the pen tool stays active after every finished stroke
          (pen.stay_active), so it never calls toolCreated. */}
      {tool === 'pen' && editable && (
        <PenTool
          camera={cam.camera}
          color={penOptions.color}
          thickness={penOptions.thickness}
          doc={doc}
          identityId={getClientId()}
          canEdit={editable}
          undo={undo}
        />
      )}

      {/* Story 11: the pen options toolbar, next to the left toolbar, only
          while the Pen tool is active (pen.options). */}
      {tool === 'pen' && (
        <PenToolbar
          color={penOptions.color}
          thickness={penOptions.thickness}
          onColor={penOptions.setColor}
          onThickness={penOptions.setThickness}
        />
      )}

      {noteToolbarVisible && singleSticky && (
        <div
          className="note-toolbar-anchor"
          style={{
            left: worldToScreen(cam.camera, {
              x: singleSticky.x + objectBounds(singleSticky).width / 2,
              y: singleSticky.y,
            }).x,
            top:
              worldToScreen(cam.camera, { x: singleSticky.x, y: singleSticky.y }).y -
              NOTE_TOOLBAR_GAP_PX,
          }}
        >
          <NoteToolbar
            color={singleStickyColor}
            onColor={(c) => {
              if (!editable) return; // story 4: edit lock
              // Story 8: one colour change is one undo step.
              undo.boundary();
              setStickyColor(doc, singleSticky.id, c);
              undo.boundary();
            }}
            onDelete={() => {
              if (!editable) return; // story 4: edit lock
              // Story 8: one delete is one undo step.
              undo.boundary();
              if (deleteObject(doc, singleSticky.id)) selection.clear();
              undo.boundary();
            }}
          />
        </div>
      )}

      {textToolbarVisible && singleText && (
        <div
          className="note-toolbar-anchor"
          style={{
            left: worldToScreen(cam.camera, {
              x: singleText.x + objectBounds(singleText).width / 2,
              y: singleText.y,
            }).x,
            top:
              worldToScreen(cam.camera, { x: singleText.x, y: singleText.y }).y -
              NOTE_TOOLBAR_GAP_PX,
          }}
        >
          <TextToolbar
            size={
              singleText.size !== undefined && singleText.size in TEXT_SIZES
                ? (singleText.size as TextSize)
                : 'M'
            }
            onSize={(s) => {
              if (!editable) return; // story 4: edit lock
              // Story 8: one size change is one undo step (the local box
              // re-measure merges into the same step).
              undo.boundary();
              setTextSize(doc, singleText.id, s);
              undo.boundary();
            }}
            onDelete={deleteSelection}
          />
        </div>
      )}

      {shapeToolbarVisible && singleShape && (
        <div
          className="note-toolbar-anchor"
          style={{
            left: worldToScreen(cam.camera, {
              x: singleShape.x + objectBounds(singleShape).width / 2,
              y: singleShape.y,
            }).x,
            top:
              worldToScreen(cam.camera, { x: singleShape.x, y: singleShape.y }).y -
              NOTE_TOOLBAR_GAP_PX,
          }}
        >
          <ShapeToolbar
            fill={singleShapeFill}
            stroke={singleShapeStroke}
            onFill={(c) => {
              if (!editable) return; // story 4: edit lock
              // Story 8: one colour change is one undo step. Only the fill
              // key is written, so the label, size, position and selection
              // are unchanged (shape.style).
              undo.boundary();
              setShapeStyle(doc, singleShape.id, { fill: c });
              undo.boundary();
            }}
            onStroke={(c) => {
              if (!editable) return; // story 4: edit lock
              undo.boundary();
              setShapeStyle(doc, singleShape.id, { stroke: c });
              undo.boundary();
            }}
          />
        </div>
      )}

      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />

      <NavigationHint visible={!cam.hasNavigated} />

      {/* Story 5: the Share button and panel sit in the top-right corner. */}
      <SharePanel boardId={boardId} />
    </div>
  );
}
