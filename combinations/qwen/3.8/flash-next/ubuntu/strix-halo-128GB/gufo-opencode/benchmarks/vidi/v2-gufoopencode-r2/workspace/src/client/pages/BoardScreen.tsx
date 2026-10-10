// The board UI (viewport, toolbar, objects, selection machinery, sync badge).
// Story 7: multi-selection, group transform gestures, marquee, keyboard
// commands, the selection overlay and the selection bar are wired here.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BoardViewport, type ViewportHandle } from '../canvas/BoardViewport';
import { installTestHook } from '../canvas/testHooks';
import type { Camera } from '../canvas/camera';
import { useBoardDoc } from '../board/useBoardDoc';
import { seedBoard } from '../board/seedBoard';
import { useSelection } from '../board/useSelection';
import { useTransformGesture } from '../board/useTransformGesture';
import { useBoardKeys } from '../board/useBoardKeys';
import { useTool } from '../board/useTool';
import { createUndo } from '../board/undo';
import { useUndo } from '../board/useUndo';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { Toolbar } from '../board/Toolbar';
import { getObjectType } from '../objects/registry';
import { createLazyMeasurer } from '../objects/textLayout';
import { remeasureTextBox } from '../objects/useTextBoxSync';
import { createText, setTextSize } from '../../shared/objects/text';
import { getIdentity } from '../identity/identity';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { TEXT_FONT_FAMILY, type TextSize } from '../../shared/config';
import {
  createSticky,
  deleteObjects,
  objectSnapshots,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import type { Point } from '../canvas/camera';

// Editing is disabled only while the board could not be loaded: every other
// state (connecting, reconnecting, confirmed) keeps the board editable.
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export function BoardScreen({ boardId }: { boardId: string }) {
  const { doc, objects, connection } = useBoardDoc(boardId);
  const selection = useSelection(objects);
  const [viewport, setViewport] = useState<ViewportHandle | null>(null);
  const [gestureActive, setGestureActive] = useState(false);

  // One undo history per tab per doc session; stacks hold only LOCAL_ORIGIN
  // steps, so remote edits can never be undone (undo.history).
  const undo = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => undo.destroy(), [undo]);
  const undoState = useUndo(undo, canEdit(connection));

  // Test-only: expose the live doc, note snapshot and connection state for
  // e2e assertions. Gated by mode so seed code and hooks are dead-code
  // eliminated from production builds.
  if (import.meta.env.MODE === 'test') {
    useEffect(() => {
      installTestHook({
        board: {
          doc,
          getNotes: () => snapshot(doc),
          getObjectSnapshots: () => objectSnapshots(doc),
          seedBoard: (count) => seedBoard(doc, count),
          undo,
        },
        connectionState: () => connection,
      });
    }, [doc, connection, undo]);
  }

  const editable = canEdit(connection);
  const camera = viewport?.camera ?? DEFAULT_CAMERA;
  const tool = useTool(editable);
  const measurer = useMemo(() => createLazyMeasurer(TEXT_FONT_FAMILY), []);

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: () => {
      setGestureActive(true);
      undo.boundary(); // the whole drag is one undo step
    },
    onGestureEnd: () => {
      setGestureActive(false);
      undo.boundary();
    },
  });

  const createStickyAtWorld = useCallback(
    (world: Point) => {
      if (!editable) return; // load_failed: creation is a no-op
      // createSticky takes the note centre, so the note lands centred here.
      undo.boundary(); // creation is one undo step
      const id = createSticky(doc, world);
      undo.boundary();
      // Creation immediately starts editing with an empty caret (FR-4).
      if (typeof id === 'string') selection.startEdit(id);
    },
    [doc, selection, editable, undo],
  );

  const createStickyAtCentre = useCallback(() => {
    if (!viewport) return;
    createStickyAtWorld(viewport.centerWorld());
  }, [viewport, createStickyAtWorld]);

  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    undoBoundary: undo.boundary,
    undoShortcuts: { undo: undoState.undo, redo: undoState.redo },
    tool,
    onCreateSticky: createStickyAtCentre,
  });

  // Text tool click: place text with its top-left at the clicked world point,
  // return to Select and start editing immediately (text.tool_ui).
  const createTextAtScreen = useCallback(
    (screen: Point) => {
      if (!editable || !viewport) return;
      const world = viewport.screenToWorld(screen);
      undo.boundary(); // creation is one undo step
      const id = createText(doc, world, getIdentity().id);
      undo.boundary();
      tool.setTool('select');
      if (id !== null) selection.startEdit(id);
    },
    [doc, selection, editable, undo, viewport, tool],
  );

  const changeTextSize = useCallback(
    (id: string, size: TextSize) => {
      if (!editable) return;
      undo.boundary(); // the size change is one undo step
      if (setTextSize(doc, id, size)) remeasureTextBox(doc, id, measurer);
      undo.boundary();
    },
    [doc, editable, undo, measurer],
  );

  const deleteSelection = useCallback(() => {
    if (!editable || selection.ids.size === 0) return;
    undo.boundary(); // the delete is one undo step
    deleteObjects(doc, [...selection.ids]);
    undo.boundary();
    selection.clear();
  }, [doc, selection, editable, undo]);

  const changeColor = useCallback(
    (id: string, color: StickySnapshot['color']) => {
      if (!editable) return;
      undo.boundary(); // the colour change is one undo step
      setStickyColor(doc, id, color);
      undo.boundary();
    },
    [doc, editable, undo],
  );

  // Render in stable creation order (never re-sorted by z) so bringToFront
  // mid-drag cannot detach the dragged node and break pointer capture; the
  // object's z-index carries the stacking order instead.
  const orderedObjects = useMemo(
    () => [...objects].sort((a, b) => a.createdAt - b.createdAt),
    [objects],
  );

  const zoom = camera.zoom;

  return (
    <>
      <ConnectionStatus state={connection} />
      <Toolbar
        onCreateSticky={createStickyAtCentre}
        disabled={!editable}
        undo={undoState}
        tool={tool.tool}
        onToolChange={tool.setTool}
      />
      <BoardViewport
        onCreateStickyAtWorld={createStickyAtWorld}
        onClearSelection={selection.clear}
        onViewportHandle={setViewport}
        snapshot={objects}
        onMarqueeSelect={(ids) => selection.setMany(ids, true)}
        textToolActive={tool.tool === 'text'}
        onCreateTextAtScreen={createTextAtScreen}
        overlay={
          <SelectionOverlay
            ids={selection.ids}
            snapshot={objects}
            camera={camera}
            onHandlePointerDown={gesture.onHandlePointerDown}
          />
        }
      >
        {orderedObjects.map((obj) => {
          const spec = getObjectType(obj.type);
          if (!spec) return null;
          const Component = spec.Component;
          return (
            <Component
              key={obj.id}
              obj={obj}
              doc={doc}
              zoom={zoom}
              selected={selection.ids.has(obj.id)}
              editing={selection.editingId === obj.id}
              editable={editable}
              undo={undo}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onStartEdit={selection.startEdit}
              onEndEdit={(next) => {
                selection.endEdit();
                if (next === 'unselected') selection.clear();
              }}
            />
          );
        })}
        <SelectionBar
          ids={selection.ids}
          snapshot={objects}
          onDelete={deleteSelection}
          suppress={gestureActive || selection.editingId !== null}
          onColor={changeColor}
          onTextSize={changeTextSize}
        />
      </BoardViewport>
    </>
  );
}
