import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  BoardCameraProvider,
  BoardViewport,
  useBoardCamera,
} from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import {
  canZoomIn as camCanZoomIn,
  canZoomOut as camCanZoomOut,
  screenToWorld,
  zoomPercent,
  type Point,
} from '../canvas/camera';
import {
  patchTestHook,
  unpatchTestHook,
  type SeedConnector,
  type SeedEndpoint,
  type SeedNote,
  type SeedShape,
  type SeedStroke,
  type SeedText,
} from '../canvas/testHooks';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { useActiveTool } from '../tools/useActiveTool';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { PenTool } from '../tools/PenTool';
import { PenToolbar } from '../tools/PenToolbar';
import { usePenOptions } from '../tools/usePenOptions';
import { useTransformGesture } from './useTransformGesture';
import { useBoardKeys } from './useBoardKeys';
import { useUndo, useUndoController } from './useUndo';
import { useMarquee, MarqueeRect } from './Marquee';
import { SelectionOverlay } from './SelectionOverlay';
import { SelectionBar } from './SelectionBar';
import { Toolbar } from './Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { TextObject } from '../objects/TextObject';
import { ShapeObject } from '../objects/ShapeObject';
import { ConnectorObject } from '../objects/ConnectorObject';
import { StrokeObject } from '../objects/StrokeObject';
import { getObjectType } from '../objects/registry';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit, type ConnectOptions, type ProviderLike } from '../sync/connectBoard';
import { SharePanel } from '../share/SharePanel';
import {
  createSticky,
  getStickyText,
  resizeObjects,
  setStickyColor,
  snapshot,
  deleteObjects,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  createText,
  getTextContent,
  setTextSize,
  setTextWidthFixed,
  textSnapshots,
  type TextSnapshot,
} from '../../shared/objects/text';
import {
  createShape,
  getShapeLabel,
  setShapeStyle,
  shapeSnapshots,
  type ShapeSnap,
} from '../../shared/objects/shape';
import {
  connectorRects,
  connectorSnapshots,
  createConnector,
  type EndpointInput,
} from '../../shared/objects/connector';
import {
  createStroke,
  strokeSnapshots,
  type StrokeSnap,
} from '../../shared/objects/stroke';
import { remeasureTextBox } from '../objects/useTextBoxSync';
import { sharedMeasurer } from '../objects/textLayout';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  SHAPE_DEFAULT_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../shared/config';

function ZoomControlsConnector() {
  const { camera, zoomStep, reset } = useBoardCamera();
  return (
    <ZoomControls
      zoomPercent={zoomPercent(camera)}
      canZoomIn={camCanZoomIn(camera)}
      canZoomOut={camCanZoomOut(camera)}
      onZoomIn={() => zoomStep('in')}
      onZoomOut={() => zoomStep('out')}
      onReset={reset}
    />
  );
}

function NavigationHintConnector() {
  const { hasNavigated } = useBoardCamera();
  return <NavigationHint visible={!hasNavigated} />;
}

/**
 * This tab's id, recorded as the author of what it creates (PRD text.create).
 * Story 6 replaces it with the board's shared identity; nothing else reads it.
 */
function useClientId(): string {
  const ref = useRef<string | null>(null);
  if (ref.current === null) ref.current = crypto.randomUUID();
  return ref.current;
}

export interface BoardProps {
  readonly boardId: string;
  readonly sync?: boolean;
  readonly provider?: ProviderLike;
  readonly connect?: ConnectOptions;
}

/**
 * The board: document, selection, objects, toolbars, connection status, share panel,
 * keyboard, transform gestures and marquee selection.
 */
export function Board(props: BoardProps) {
  return (
    <BoardCameraProvider>
      <BoardInside {...props} />
      <ZoomControlsConnector />
      <NavigationHintConnector />
    </BoardCameraProvider>
  );
}

function BoardInside({ boardId, sync = true, provider, connect }: BoardProps) {
  const { doc, notes, texts, shapes, connectors, strokes, connection, connectionState } =
    useBoardDoc(boardId, { sync, provider, connect });
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const { camera, viewport } = useBoardCamera();
  const editable = canEdit(connectionState);
  const clientId = useClientId();
  /** Shape ids the browser fixtures seeded, so a connector fixture can join them. */
  const seededShapesRef = useRef<string[]>([]);
  const seededShapes = seededShapesRef.current;
  // Every object that has a box, in one paint order, so a text, a note and a shape
  // interleave by `z` and one selection/marquee/gesture path sees one state
  // (PRD text.consistent, shape.consistent).
  const objects = useMemo(
    () =>
      [
        ...(notes as readonly (StickySnapshot | TextSnapshot | ShapeSnap | StrokeSnap)[]),
        ...texts,
        ...shapes,
        ...strokes,
      ].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [notes, texts, shapes, strokes],
  );
  /** Connectors paint below everything with a box: an arrow points at things, it does
   *  not cover them. */
  const connectorsPainted = connectors;
  /**
   * The same objects plus the connectors, seen as the generic kind the selection,
   * marquee and delete machinery works with — an arrow is selectable and deletable
   * like anything else (PRD connector.select).
   */
  const objectSnapshots = useMemo(
    () => [...objects, ...connectorsPainted] as unknown as readonly ObjectSnapshot[],
    [objects, connectorsPainted],
  );
  /** Objects an arrow end may be attached to, as the connector's handle needs them. */
  const attachableRects = useMemo(() => connectorRects(doc), [doc, objects]);

  // This tab's undo history for this board: it holds nothing but what this person
  // did here, and it goes away with the board (PRD undo.own, undo.session_only).
  const undo = useUndoController(doc);
  const undoControls = useUndo(undo, editable);

  // Selection now takes the snapshot so it can prune deleted ids
  const selection = useSelection(objectSnapshots);
  const { ids: selectedIds, editingId, click, setMany, clear, startEdit, endEdit } = selection;

  // Which tool this tab is in (story 9, story 10). It is per tab: two people on one
  // board are never in each other's tool. It is asked for after the selection, so a
  // tool that has just created something can select it (PRD tools.return_to_select).
  const tool = useActiveTool({ canEdit: editable, selection });

  /* Which pen this tab is holding (PRD pen.options). Session state only: it is not
     written to the document, a colleague's pen is never changed from here, and a
     reload brings the defaults back. The Pen tool is the one creating tool that does
     not call `toolCreated` — it stays drawing (PRD pen.stay_active). */
  const pen = usePenOptions();

  // Transform gesture: group move and resize
  const transformGesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objectSnapshots,
    canEdit: editable,
    // A text dragged by a side handle is measured here too, so its new height lands
    // in the same gesture (and the same undo step) as its new width.
    measure: sharedMeasurer(),
    // One gesture, one undo step: the window is closed when the drag begins and
    // again when it ends (or is cancelled), so its frames merge with each other and
    // never with the change before or after it (PRD undo.steps).
    onGestureStart: undo.boundary,
    onGestureEnd: undo.boundary,
  });

  // Marquee selection
  const marquee = useMarquee(
    camera,
    objectSnapshots,
    useCallback((ids: string[]) => setMany(ids, true), [setMany]),
  );

  // Enter edits the single selected object — a note since story 2, a text since story 9
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!editable) return;
      if (selection.editingId) return;
      const target = event.target as HTMLElement;
      if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (selectedIds.size === 1) {
        const id = [...selectedIds][0];
        const object = objects.find((o) => o.id === id);
        if (object && getObjectType(object.type)?.editableText) {
          event.preventDefault();
          startEdit(id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editable, selectedIds, objects, startEdit]);

  /** Create a note centred on a screen-space point, and start typing it. */
  const createAtScreenPoint = useCallback(
    (point: Point) => {
      if (!editable) return;
      const world = screenToWorld(camera, point);
      // One creation is one step, and it never merges with the typing that follows
      // in the new note (PRD undo.steps).
      undo.boundary();
      const id = createSticky(doc, world);
      undo.boundary();
      if (id) {
        clear();
        startEdit(id);
      }
    },
    [camera, doc, editable, clear, startEdit, undo],
  );

  /**
   * Put a text with its top-left where the Text tool was clicked (PRD text.create),
   * then type straight into it. The tool goes back to Select after one text, so
   * clicking twice in a row does not make two, and moving things afterwards needs
   * no mode change (PRD text.tool).
   */
  const createTextAtScreenPoint = useCallback(
    (point: Point) => {
      if (!editable) return;
      const world = screenToWorld(camera, point);
      // Creating one text is one undo step, and the typing that follows is not part
      // of it (PRD undo.steps).
      undo.boundary();
      const id = createText(doc, world, clientId);
      undo.boundary();
      if (!id) return;
      clear();
      startEdit(id);
      // One text per click: the tool goes back to Select, so the next click moves.
      tool.setTool('select');
    },
    [camera, doc, clientId, editable, clear, startEdit, tool, undo],
  );

  const onCreateSticky = useCallback(
    () => createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 }),
    [createAtScreenPoint, viewport],
  );

  /**
   * A tool made something: the drawing is one undo step of its own, it becomes the
   * selected thing, and the board goes back to Select so it can be moved straight
   * afterwards (PRD tools.return_to_select).
   */
  const onToolCreated = useCallback(
    (id: string) => {
      undo.boundary();
      tool.toolCreated(id);
    },
    [undo, tool],
  );

  // Keyboard commands: story 9's tool shortcuts, story 2's N (now a real shortcut) and
  // the delete/undo/selection keys. It is wired after the create actions because N runs
  // exactly the toolbar's Sticky note button.
  useBoardKeys({
    doc,
    selection,
    snapshot: objectSnapshots,
    canEdit: editable,
    undo,
    tool,
    onCreateSticky,
  });

  // --------------------------------------------------- test-only inspection
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    patchTestHook({
      getDoc: () => doc,
      getSnapshot: () => snapshot(doc),
      getTexts: () => textSnapshots(doc),
      getShapes: () => shapeSnapshots(doc),
      getConnectors: () => connectorSnapshots(doc),
      getStrokes: () => strokeSnapshots(doc),
      getSelection: (): { selectedId: string | null; editingId: string | null; selectedIds?: string[] } => {
        const ids = [...selectedIds];
        const base: { selectedId: string | null; editingId: string | null; selectedIds?: string[] } = {
          selectedId: ids.length === 1 ? ids[0] : null,
          editingId: editingId,
        };
        if (ids.length > 1) base.selectedIds = ids;
        return base;
      },
      getConnectionState: () => connectionState,
      dropConnection: () => connectionRef.current?.dropConnection(),
      resumeConnection: () => connectionRef.current?.resumeConnection(),
      seedBoard: (count: number) => {
        doc.transact(() => {
          for (let i = 0; i < count; i++) {
            const id = createSticky(doc, { x: (i % 50) * 230, y: Math.floor(i / 50) * 230 });
            if (id) getStickyText(doc, id)?.insert(0, `note ${i + 1} of ${count}`);
          }
        });
      },
      seedNotes: (specs: readonly SeedNote[]) => {
        const ids: string[] = [];
        // No origin of ours: the notes arrive the way a saved board does, so they are
        // nobody's undo step (story 8 fixtures).
        doc.transact(() => {
          for (const spec of specs) {
            const width = spec.width ?? STICKY_SIZE_WORLD;
            const height = spec.height ?? STICKY_SIZE_WORLD;
            const id = createSticky(doc, { x: spec.x + width / 2, y: spec.y + height / 2 }, spec.color ?? 'yellow');
            if (!id) continue;
            if (spec.width != null || spec.height != null) {
              resizeObjects(doc, new Map([[id, { x: spec.x, y: spec.y, width, height }] as const]));
            }
            if (spec.color) setStickyColor(doc, id, spec.color);
            if (spec.text) getStickyText(doc, id)?.insert(0, spec.text);
            ids.push(id);
          }
        });
        return ids;
      },
      seedShapes: (specs: readonly SeedShape[]) => {
        const ids: string[] = [];
        // Seeded as if the board had been saved with the shapes on it (story 10).
        doc.transact(() => {
          for (const spec of specs) {
            const width = spec.width ?? SHAPE_DEFAULT_SIZE_WORLD;
            const height = spec.height ?? SHAPE_DEFAULT_SIZE_WORLD;
            const id = createShape(
              doc,
              {
                kind: spec.kind ?? 'rect',
                rect: { x: spec.x, y: spec.y, width, height },
                at: { x: spec.x + width / 2, y: spec.y + height / 2 },
              },
              spec.createdBy ?? clientId,
            );
            if (!id) continue;
            if (spec.fill || spec.stroke) setShapeStyle(doc, id, { fill: spec.fill, stroke: spec.stroke });
            if (spec.label) getShapeLabel(doc, id)?.insert(0, spec.label);
            seededShapes.push(id);
            ids.push(id);
          }
        });
        return ids;
      },
      seedConnectors: (specs: readonly SeedConnector[]) => {
        const ids: string[] = [];
        // An end names an object already on the board (by id, or by a shape from an
        // earlier seedShapes call), or a point of the board.
        const anchorCentre = (objectId: string): Point => {
          const rect = connectorRects(doc).get(objectId);
          if (!rect) throw new Error(`seedConnectors: nothing called ${objectId} to attach to`);
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        };
        const end = (e: SeedEndpoint): EndpointInput => {
          if (e.objectId != null) {
            return { kind: 'attached', objectId: e.objectId, fallback: anchorCentre(e.objectId) };
          }
          if (e.shapeIndex != null) {
            const objectId = seededShapes[e.shapeIndex];
            if (!objectId) {
              throw new Error(`seedConnectors: no seeded shape at index ${e.shapeIndex}`);
            }
            return { kind: 'attached', objectId, fallback: anchorCentre(objectId) };
          }
          if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) {
            throw new Error('seedConnectors: a free end needs finite x and y');
          }
          return { kind: 'free', x: e.x!, y: e.y! };
        };
        doc.transact(() => {
          for (const spec of specs) {
            const id = createConnector(
              doc,
              end(spec.from),
              end(spec.to),
              spec.createdBy ?? clientId,
            );
            if (id) ids.push(id);
          }
        });
        return ids;
      },
      seedStrokes: (specs: readonly SeedStroke[]) => {
        const ids: string[] = [];
        // Seeded as if the board had been saved with the drawing on it (story 11).
        doc.transact(() => {
          for (const spec of specs) {
            const id = createStroke(
              doc,
              {
                points: spec.points,
                color: spec.color ?? DEFAULT_PEN_COLOR,
                thickness: spec.thickness ?? DEFAULT_PEN_THICKNESS,
              },
              spec.createdBy ?? clientId,
            );
            if (id) ids.push(id);
          }
        });
        return ids;
      },
      seedTexts: (specs: readonly SeedText[]) => {
        const ids: string[] = [];
        // Seeded like seedNotes: as if the board had been saved with them on it.
        doc.transact(() => {
          for (const spec of specs) {
            const id = createText(doc, { x: spec.x, y: spec.y }, spec.createdBy ?? clientId);
            if (!id) continue;
            if (spec.text) getTextContent(doc, id)?.insert(0, spec.text);
            if (spec.size) setTextSize(doc, id, spec.size);
            if (spec.width != null) setTextWidthFixed(doc, id, spec.width);
            // The box this client would have written when it made them.
            remeasureTextBox(doc, id, sharedMeasurer());
            ids.push(id);
          }
        });
        return ids;
      },
      undo: () => undo.undo(),
      redo: () => undo.redo(),
      canUndo: () => undo.canUndo(),
      canRedo: () => undo.canRedo(),
    });
    return () =>
      unpatchTestHook([
        'getDoc',
        'getSnapshot',
        'getSelection',
        'getConnectionState',
        'dropConnection',
        'resumeConnection',
        'seedBoard',
        'seedNotes',
        'seedTexts',
        'seedShapes',
        'seedConnectors',
        'seedStrokes',
        'getTexts',
        'getShapes',
        'getConnectors',
        'getStrokes',
        'undo',
        'redo',
        'canUndo',
        'canRedo',
      ]);
  }, [doc, connectionState, selectedIds, editingId, undo, clientId, seededShapes]);

  const onSelect = useCallback((id: string) => click(id), [click]);
  const onStartEdit = useCallback((id: string) => startEdit(id), [startEdit]);
  const onEndEdit = useCallback((next: 'selected' | 'unselected') => {
    if (next === 'unselected') clear();
    else endEdit();
  }, [clear, endEdit]);

  // A text object talks to the same selection/edit/delete paths a note uses; only
  // its props are shaped differently (PRD text.consistent).
  const onEditChange = useCallback(
    (id: string | null) => {
      if (id === null) endEdit();
      else startEdit(id);
    },
    [endEdit, startEdit],
  );
  const onSelectChange = useCallback(
    (id: string | null) => {
      if (id === null) clear();
      else click(id);
    },
    [clear, click],
  );
  const onDeleteObject = useCallback(
    (id: string) => {
      if (!editable) return;
      // One delete, whatever kind of object it was, is one undo step (PRD undo.steps).
      undo.boundary();
      deleteObjects(doc, [id]);
      undo.boundary();
      clear();
    },
    [doc, editable, undo, clear],
  );

  const onDeleteSelection = useCallback(() => {
    if (!editable) return;
    // One delete of any number of notes is one step (PRD undo.steps).
    undo.boundary();
    deleteObjects(doc, [...selectedIds]);
    undo.boundary();
    clear();
  }, [doc, selectedIds, clear, editable, undo]);

  // Selection overlay handles
  const onHandlePointerDown = transformGesture.onHandlePointerDown;

  // Empty click clears selection (only when not editing)
  const onEmptyClick = useCallback(() => {
    clear();
  }, [clear]);

  return (
    <div data-testid="board" data-board-id={boardId}>
      <BoardViewport
        tool={tool.tool}
        onCreateStickyAt={createAtScreenPoint}
        onCreateTextAt={createTextAtScreenPoint}
        onEmptyClick={onEmptyClick}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
        toolOverlay={
          editable && tool.tool === 'pen' ? (
            <PenTool
              camera={camera}
              color={pen.color}
              thickness={pen.thickness}
              doc={doc}
              identityId={clientId}
              undo={undo}
            />
          ) : null
        }
      >
        {connectorsPainted.map((connector) => (
          <ConnectorObject
            key={connector.id}
            connector={connector}
            rects={attachableRects}
            doc={doc}
            zoom={camera.zoom}
            camera={camera}
            editable={editable}
            selected={selectedIds.has(connector.id)}
            onObjectPointerDown={transformGesture.onObjectPointerDown}
            onSelect={onSelect}
            undo={undo}
          />
        ))}
        {objects.map((object) =>
          object.type === 'shape' ? (
            <ShapeObject
              key={object.id}
              shape={object}
              doc={doc}
              zoom={camera.zoom}
              editable={editable}
              selected={selectedIds.has(object.id)}
              editing={editingId === object.id}
              dragging={transformGesture.draggingIds.has(object.id)}
              onSelect={onSelect}
              onStartEdit={onStartEdit}
              onEndEdit={onEndEdit}
              onObjectPointerDown={transformGesture.onObjectPointerDown}
              undo={undo}
            />
          ) : object.type === 'text' ? (
            <TextObject
              key={object.id}
              doc={doc}
              id={object.id}
              size={object.size}
              x={object.x}
              y={object.y}
              width={object.width}
              height={object.height}
              widthMode={object.widthMode}
              createdBy={object.createdBy}
              zoom={camera.zoom}
              editable={editable}
              selected={selectedIds.has(object.id)}
              editing={editingId === object.id}
              onEditChange={onEditChange}
              onSelectionChange={onSelectChange}
              onObjectPointerDown={transformGesture.onObjectPointerDown}
              onDelete={onDeleteObject}
              undo={undo}
            />
          ) : object.type === 'stroke' ? (
            <StrokeObject
              key={object.id}
              stroke={object}
              zoom={camera.zoom}
              editable={editable}
              selected={selectedIds.has(object.id)}
              onObjectPointerDown={transformGesture.onObjectPointerDown}
              onSelect={onSelect}
            />
          ) : (
            <StickyNote
              key={object.id}
              note={object}
              doc={doc}
              zoom={camera.zoom}
              editable={editable}
              selected={selectedIds.has(object.id)}
              editing={editingId === object.id}
              dragging={transformGesture.draggingIds.has(object.id)}
              onSelect={onSelect}
              onStartEdit={onStartEdit}
              onEndEdit={onEndEdit}
              onObjectPointerDown={transformGesture.onObjectPointerDown}
              undo={undo}
            />
          ),
        )}
      </BoardViewport>

      {/* The tool's own surface, while a creating tool is active (PRD shape.create_drag,
          connector.create_attached): it holds the pointer, so a drag that starts on an
          existing object draws instead of moving it. */}
      {editable && tool.tool === 'shape' ? (
        <ShapeTool
          kind={tool.shapeKind}
          camera={camera}
          doc={doc}
          createdBy={clientId}
          onCreated={onToolCreated}
        />
      ) : null}
      {editable && tool.tool === 'connector' ? (
        <ConnectorTool
          camera={camera}
          snapshot={objectSnapshots}
          doc={doc}
          createdBy={clientId}
          onCreated={onToolCreated}
        />
      ) : null}

      {/* Selection overlay: bounding box + handles */}
      {selectedIds.size > 0 && (
        <SelectionOverlay
          ids={selectedIds}
          snapshot={objectSnapshots}
          camera={camera}
          onHandlePointerDown={onHandlePointerDown}
        />
      )}

      {/* Marquee rectangle (screen space) */}
      <MarqueeRect rect={marquee.rect} camera={camera} />

      {/* Selection bar (>= 2 selected) */}
      <SelectionBar ids={selectedIds} snapshot={objectSnapshots} onDelete={onDeleteSelection} />

      {/* `penOptions` is what the next stroke will be drawn with, shown while the Pen
          tool is active (PRD pen.options). It never restyles an existing stroke. */}
      <Toolbar
        onCreateSticky={onCreateSticky}
        disabled={!editable}
        undo={undoControls}
        tool={tool}
        penOptions={
          tool.tool === 'pen' ? (
            <PenToolbar
              color={pen.color}
              thickness={pen.thickness}
              onColor={pen.setColor}
              onThickness={pen.setThickness}
            />
          ) : undefined
        }
      />
      <ConnectionStatus state={connectionState} />
      <SharePanel boardId={boardId} />
    </div>
  );
}
