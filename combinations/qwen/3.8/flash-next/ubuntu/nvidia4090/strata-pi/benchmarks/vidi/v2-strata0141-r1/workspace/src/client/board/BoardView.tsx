import { useCallback, useEffect, useState, type ComponentType } from 'react';
import type * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  isConnectorSnapshot,
  isShapeSnapshot,
  isTextSnapshot,
  objectSnapshots,
  snapshot,
} from '../../shared/board-model';
import { createText, getTextContent, setTextSize } from '../../shared/objects/text';
import { createShape, getShapeLabel, setShapeStyle } from '../../shared/objects/shape';
import { createConnector } from '../../shared/objects/connector';
import { registerBoardApi, registerSeedApi } from '../testHooks';
import { STICKY_COLOR_NAMES, type TextSize } from '../../shared/config';
import { useClientId } from '../useClientId';
import { BoardViewport, viewportCentre, type BoardSurface } from '../canvas/BoardViewport';
import { screenToWorld, type Camera } from '../canvas/camera';
import { Toolbar } from './Toolbar';
import { useBoardDoc } from './useBoardDoc';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { BoardProvider } from '../sync/connectBoard';
import { useSelection } from './useSelection';
import { useTransformGesture, selectionHasResizableType } from './useTransformGesture';
import { SelectionBar } from './SelectionBar';
import { SelectionOverlay } from './SelectionOverlay';
import { useMarquee, MarqueeRect } from './Marquee';
import { useBoardKeys } from './useBoardKeys';
import { useActiveTool } from '../tools/useActiveTool';
import { hitTestObjectAt } from '../objects/registry';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { UndoControllerContext, useUndo, useUndoController } from './useUndo';
import type { UndoController } from './undo';
// Importing the registry is what registers the board's object types; every
// object on the board is drawn by the component its type registered.
import { getObjectType, selectionHandlesMode, type ObjectProps } from '../objects/registry';
import { remeasureTextBox, useMeasurer } from '../objects/useTextBoxSync';

/**
 * The board: the camera surface from story 1, the object layer from stories 2
 * and 7, the live connection from story 3 and the load-failure rule from
 * story 4. The Y.Doc, the selection, the gesture and the toolbars are wired
 * here; every mutation goes through `src/shared/board-model.ts`.
 *
 * Story 7 made this the only place that knows how a board object is *used*: it
 * renders each object through its registered component (`sel.all_types`), keeps
 * the selection (`sel.interaction`), hands pointerdown to the shared transform
 * gesture (`sel.transform`), runs the marquee (`sel.marquee_ui`) and the
 * selection keys (`sel.keyboard`). An object type contributes its component and
 * four flags, and nothing else.
 *
 * `doc` is injectable so component tests can inspect the exact same document the
 * UI writes to, and `connect` can be turned off so a component test never opens
 * a socket.
 */
export interface BoardViewProps {
  /** A document to render instead of creating one (component tests). */
  doc?: Y.Doc;
  /** The board this page is on. */
  boardId: string;
  /** False keeps the room connection away (component tests). */
  connect?: boolean;
  /** A fake room connection, for UI-component tests. */
  providerFactory?: (url: string, boardId: string, doc: Y.Doc) => BoardProvider;
  /**
   * Transform gesture boundaries. Story 8 uses them to open and close one undo
   * step per gesture; they are reported here because this is where a board's
   * gestures begin and end.
   */
  onTransformStart?: () => void;
  onTransformEnd?: () => void;
  /**
   * The undo history to use instead of making one (`undo.history`). A test that
   * wants to read the same stacks the toolbar reads passes its own controller;
   * the app never passes one, and the board owns its history.
   */
  undo?: UndoController;
}

const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export function BoardView({
  doc: providedDoc,
  boardId,
  connect = true,
  providerFactory,
  onTransformStart,
  onTransformEnd,
  undo: providedUndo,
}: BoardViewProps) {
  const { doc, objects, connectionState } = useBoardDoc({
    doc: providedDoc,
    boardId,
    connect,
    providerFactory,
  });
  const [surface, setSurface] = useState<BoardSurface | null>(null);

  /**
   * A board the room could not load is not editable (`persist.client_status`).
   * Editing a copy of a board we have not been given would put changes somewhere
   * they cannot be saved and cannot be seen, so every mutation entry point is
   * closed while `connectionState` is `load_failed`. Reconnecting needs no page
   * reload: the same page edits again as soon as the room serves the board.
   */
  const editable = connectionState !== 'load_failed';

  const camera = surface?.camera ?? INITIAL_CAMERA;
  const zoom = camera.zoom;

  /** Per-client selection, pruned against the board as other people change it. */
  const selection = useSelection(objects);

  /** Per-client tool state (`text.tool_ui`): Select or Text, never persisted. */
  // The tool this client is holding, now including story 10's Shape and Connector
  // tools (`tool.shortcuts`, `tool.return_to_select`). Everything story 9 had for
  // Select and Text is unchanged: this only adds tools the board can be holding and
  // the `toolCreated` report a new tool makes when it makes something.
  const active = useActiveTool({
    canEdit: editable,
    editing: selection.editingId !== null,
    select: (ids) => selection.setMany(ids, false),
  });
  const activeTool = active.tool;
  const setTool = active.setTool;
  /** The one measurer this board writes boxes with (`text.layout`). */
  const measure = useMeasurer();
  /** The owner a new text object records (story 6 replaces this with an identity). */
  const clientId = useClientId();

  const undoController = useUndoController(doc, providedUndo);
  const undoState = useUndo(undoController, editable);

  /**
   * One gesture is one undo step, however many frames it wrote and however long
   * it lasted (`undo.steps`, TC-14): the step is opened when a gesture crosses
   * the drag threshold and closed when it ends.
   */
  const onGestureStart = useCallback(() => {
    undoController.group(true);
    onTransformStart?.();
  }, [onTransformStart, undoController]);
  const onGestureEnd = useCallback(() => {
    undoController.group(false);
    onTransformEnd?.();
  }, [onTransformEnd, undoController]);

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    // A horizontal drag on text measures the height that follows from the new
    // width, here, by this client (`text.height`, Key decision 1).
    measure,
    onGestureStart,
    onGestureEnd,
  });

  const marquee = useMarquee(camera, objects, (ids) => selection.setMany(ids, true));

  /** Create a note centred on a world point and start editing it right away. */
  const createAt = useCallback(
    (world: { x: number; y: number }) => {
      if (!editable) {
        return;
      }
      // A creation is a step of its own, whatever was typed or moved before it.
      undoController.boundary();
      const id = createSticky(doc, world);
      undoController.boundary();
      if (id !== '') {
        selection.startEdit(id);
      }
    },
    [doc, editable, selection, undoController.boundary],
  );

  /** Toolbar creation: the centre of the visible board, wherever it is panned. */
  const createAtViewportCentre = useCallback(() => {
    if (!surface) {
      return;
    }
    // The surface centre is a screen point; the model wants the world point it shows.
    createAt(screenToWorld(surface.camera, viewportCentre(surface)));
  }, [createAt, surface]);

  /**
   * The Text tool's click (`text.tool_ui`, TC-17): a text object whose **top-left**
   * is the point that was clicked, the tool back to Select, and editing started on
   * the new object - so the first character is typed without another click. One
   * creation is one undo step (TC-17).
   */
  const createTextAt = useCallback(
    (world: { x: number; y: number }) => {
      if (!editable) {
        return;
      }
      undoController.boundary();
      const id = createText(doc, world, clientId);
      undoController.boundary();
      setTool('select');
      if (id !== null) {
        selection.startEdit(id);
      }
    },
    [clientId, doc, editable, selection, setTool, undoController.boundary],
  );

  /**
   * Empty board space released without panning: with the Select tool that clears
   * the selection (TC-19), with the Text tool it places text (`text.tool_ui`).
   */
  const onBoardClick = useCallback(
    (world: { x: number; y: number }) => {
      if (activeTool === 'text') {
        createTextAt(world);
        return;
      }
      // One type never gets a click of its own, because it is too thin to land on:
      // an arrow. A click that missed it by a few pixels is exactly the case a
      // distance test decides, so the board asks each object in its own type's way
      // here - and an object that was clicked *on* never reaches here at all, because
      // its own handler took the click (`sel.registry`, `connector.select`, TC-20).
      const hit = hitTestObjectAt(objects, world, zoom);
      if (hit) {
        selection.click(hit.id);
        return;
      }
      selection.clear();
    },
    [activeTool, createTextAt, objects, selection, zoom],
  );

  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    history: {
      undo: undoState.undo,
      redo: undoState.redo,
      boundary: undoController.boundary,
    },
    // `text.tool_ui`: V and Escape go back to Select, T holds the Text tool, N is
    // story 2's sticky note created at the centre of the view (TC-18).
    selectTool: () => setTool('select'),
    textTool: () => setTool('text'),
    createSticky: createAtViewportCentre,
  });

  /** Starting to edit is a mutation too: a note's text is the document. */
  const editNote = useCallback(
    (id: string) => {
      if (!editable) {
        return;
      }
      selection.startEdit(id);
    },
    [editable, selection],
  );

  const deleteSelection = useCallback(() => {
    if (!editable) {
      return;
    }
    undoController.boundary();
    deleteObjects(doc, [...selection.ids]);
    undoController.boundary();
    selection.clear();
  }, [doc, editable, selection, undoController.boundary]);

  /**
   * A size chosen from the text toolbar (`text.object`, TC-21): the letters change,
   * where they sit does not, and the box the new size needs is measured here, by
   * this client, in the same undo step as the change.
   */
  const changeTextSize = useCallback(
    (id: string, size: TextSize) => {
      if (!editable) {
        return;
      }
      undoController.boundary();
      if (setTextSize(doc, id, size)) {
        remeasureTextBox(doc, id, measure);
      }
      undoController.boundary();
    },
    [doc, editable, measure, undoController.boundary],
  );

  const onEmptyDrag = useCallback(
    (phase: 'begin' | 'move' | 'end' | 'cancel', screen: { x: number; y: number }) => {
      if (phase === 'begin') {
        marquee.begin(screen);
      } else if (phase === 'move') {
        marquee.move(screen);
      } else if (phase === 'end') {
        marquee.end();
      } else {
        marquee.cancel();
      }
    },
    [marquee],
  );

  // e2e hooks: read and create notes through the model (test build only).
  useEffect(() => {
    registerBoardApi({
      notes: () => [...snapshot(doc)],
      createNote: (params) => {
        const id = createSticky(doc, params.at, params.color);
        if (id !== '' && params.text !== undefined) {
          getStickyText(doc, id)?.insert(0, params.text);
        }
        return id;
      },
      texts: () => objectSnapshots(doc).filter(isTextSnapshot),
      createText: (params) => {
        const id = createText(doc, params.at, 'test-hook');
        if (id === null) {
          return '';
        }
        if (params.size !== undefined) {
          setTextSize(doc, id, params.size);
        }
        if (params.text !== undefined) {
          getTextContent(doc, id)?.insert(0, params.text);
        }
        return id;
      },
      // Story 10's two object kinds, for test setup: the e2e tests seed boards and
      // race against remote deletes through the same model calls the UI makes.
      shapes: () => objectSnapshots(doc).filter(isShapeSnapshot),
      createShape: (params) => {
        const id = createShape(
          doc,
          {
            kind: params.kind ?? 'rect',
            rect: params.size
              ? { x: params.at.x, y: params.at.y, width: params.size.width, height: params.size.height }
              : null,
            at: params.at,
            square: params.square ?? false,
          },
          'test-hook',
        );
        if (id === null) {
          return '';
        }
        if (params.fill !== undefined || params.stroke !== undefined) {
          setShapeStyle(doc, id, { fill: params.fill, stroke: params.stroke });
        }
        if (params.label !== undefined) {
          getShapeLabel(doc, id)?.insert(0, params.label);
        }
        return id;
      },
      connectors: () => objectSnapshots(doc).filter(isConnectorSnapshot),
      createConnector: (params) => createConnector(doc, params.from, params.to, 'test-hook') ?? '',
      connectionState: () => connectionState,
    });
    // Seeding a big board is one transaction, so a test sets up a board the size
    // of a real one without spending one update per note.
    registerSeedApi({
      seed: (params) => {
        const columns = Math.max(
          1,
          Math.ceil(Math.sqrt(params.count * (params.area.width / Math.max(1, params.area.height)))),
        );
        doc.transact(() => {
          for (let index = 0; index < params.count; index += 1) {
            const column = index % columns;
            const row = Math.floor(index / columns);
            createSticky(
              doc,
              {
                x: params.area.x + (column + 0.5) * (params.area.width / columns),
                y: params.area.y + (row + 0.5) * (params.area.height / Math.max(1, Math.ceil(params.count / columns))),
              },
              STICKY_COLOR_NAMES[index % STICKY_COLOR_NAMES.length],
            );
          }
        });
        return params.count;
      },
    });
    return () => {
      registerBoardApi(null);
      registerSeedApi(null);
    };
  }, [doc, connectionState]);

  const resizable = selectionHasResizableType(selection.ids, objects);
  /** Text objects have no top or bottom handles; a mixed selection does (Key decision 2). */
  const handles = selectionHandlesMode(
    selection.ids,
    (id) => objects.find((entry) => entry.id === id)?.type ?? '',
  );

  const board = (
    <main
      className="app"
      data-app="vidi6"
      data-testid="app"
      data-board-editable={editable ? 'true' : 'false'}
      data-tool={activeTool}
      data-editing-id={selection.editingId ?? ''}
      data-selection-count={selection.ids.size}
    >
      <BoardViewport
        onSurfaceChange={setSurface}
        onEmptyDoubleClick={createAt}
        onEmptyClick={onBoardClick}
        onEmptyDrag={onEmptyDrag}
        tool={activeTool}
        onTextClick={createTextAt}
      >
        {objects.map((obj) => {
          const spec = getObjectType(obj.type);
          if (!spec) {
            return null; // a type nothing can draw is not drawn (TC-12)
          }
          const Component = spec.Component as ComponentType<ObjectProps>;
          return (
            <Component
              key={obj.id}
              obj={obj}
              doc={doc}
              zoom={zoom}
              selected={selection.ids.has(obj.id)}
              editing={selection.editingId === obj.id}
              dragging={gesture.activeIds.has(obj.id)}
              editable={editable}
              onSelect={(id, additive) => (additive ? selection.toggle(id) : selection.click(id))}
              onStartEdit={editNote}
              onEndEdit={(next) => (next === 'selected' ? selection.endEdit() : selection.clear())}
              onObjectPointerDown={gesture.onObjectPointerDown}
              surface={surface}
            />
          );
        })}
      </BoardViewport>
      <MarqueeRect rect={marquee.rect} camera={camera} />
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={camera}
        resizable={resizable}
        handles={handles}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={objects}
        onDelete={deleteSelection}
        onTextSize={changeTextSize}
      />
      <Toolbar
        onCreateSticky={createAtViewportCentre}
        tool={activeTool}
        onSelectTool={setTool}
        shapeKind={active.shapeKind}
        onShapeKind={active.setShapeKind}
        disabled={!editable}
        undo={undoState}
      />
      {/* Story 10's two tools. Each draws only while it is the tool the board is
          holding, and each reports the object it made through `toolCreated`
          (`shape.ui`, `connector.ui`, `tool.return_to_select`). */}
      <ShapeTool
        doc={doc}
        armed={activeTool === 'shape'}
        shapeKind={active.shapeKind}
        surface={surface}
        createdBy={clientId}
        onCreated={active.toolCreated}
      />
      <ConnectorTool
        doc={doc}
        armed={activeTool === 'connector'}
        objects={objects}
        surface={surface}
        createdBy={clientId}
        onCreated={active.toolCreated}
      />
      <ConnectionStatus state={connectionState} />
    </main>
  );

  /**
   * The object components are inside the history's context: a note's colour, its
   * bin button and its text editor all close a step around the one write they
   * make, and none of them needs a prop for it (`ObjectProps` is unchanged).
   */
  return <UndoControllerContext.Provider value={undoController}>{board}</UndoControllerContext.Provider>;
}
