import { useMemo, useRef, useState } from 'react';
import { UndoContext, useUndo, useUndoHistory } from './board/useUndo';
import { createSticky, deleteObjects, setStickyColor } from '../shared/board-model';
import { connectableRects } from '../shared/objects/connector';
import { setShapeStyle } from '../shared/objects/shape';
import { createText, setTextSize } from '../shared/objects/text';
import { SelectionBar } from './board/SelectionBar';
import { SelectionOverlay } from './board/SelectionOverlay';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useBoardKeys } from './board/useBoardKeys';
import { useSelection } from './board/useSelection';
import { ConnectorTool } from './tools/ConnectorTool';
import { PenTool } from './tools/PenTool';
import { PenToolbar } from './tools/PenToolbar';
import { usePenOptions } from './tools/usePenOptions';
import { ShapeTool } from './tools/ShapeTool';
import { useActiveTool } from './tools/useActiveTool';
import { getLocalUserId } from './identity';
import { getDefaultMeasurer } from './objects/textLayout';
import { remeasureText } from './objects/useTextBoxSync';
import { useTransformGesture } from './board/useTransformGesture';
import type { Camera, Point } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { getObjectType } from './objects/registry';

const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/** Editing is blocked only while the saved board cannot be loaded (never present it as an empty editable board). */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function App({ boardId }: { boardId?: string } = {}) {
  const { doc, objects, connection } = useBoardDoc(boardId);
  const sel = useSelection(objects);
  const [gesturing, setGesturing] = useState(false);
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);

  const editable = canEdit(connection);
  const history = useUndoHistory(doc);
  const undo = useUndo(history, editable);
  const gesture = useTransformGesture({
    doc,
    camera,
    selection: sel,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: () => {
      history.boundary();
      setGesturing(true);
    },
    onGestureEnd: () => {
      history.boundary();
      setGesturing(false);
    },
  });
  const pen = usePenOptions();
  const tool = useActiveTool({ canEdit: editable, onSelect: sel.select });
  // Stacking order (the snapshot is sorted by z): arrows resolve their ends from these.
  const rects = useMemo(() => connectableRects(objects), [objects]);
  const centerRef = useRef<() => Point>(() => ({ x: 0, y: 0 }));

  const create = (at: Point) => {
    if (!editable) return;
    history.boundary();
    const id = createSticky(doc, at);
    history.boundary();
    if (id) sel.startEdit(id);
  };

  useBoardKeys({
    doc,
    selection: sel,
    snapshot: objects,
    canEdit: editable,
    undo: history,
    tool,
    onCreateSticky: () => create(centerRef.current()),
  });

  const placeText = (at: Point) => {
    if (!editable) return;
    history.boundary();
    // No boundary after: creating and typing the first characters undo as one step.
    const id = createText(doc, at, getLocalUserId());
    tool.setTool('select');
    if (id) sel.startEdit(id);
  };

  const deleteSelection = () => {
    history.boundary();
    deleteObjects(doc, [...sel.ids]);
    history.boundary();
    sel.clear();
  };

  return (
    <UndoContext.Provider value={history}>
    <BoardViewport
      onCreateAt={create}
      textToolActive={tool.tool === 'text'}
      tool={tool.tool}
      toolLayer={
        editable && tool.tool === 'shape' ? (
          <ShapeTool kind={tool.shapeKind} camera={camera} doc={doc} onCreated={tool.toolCreated} />
        ) : editable && tool.tool === 'connector' ? (
          <ConnectorTool camera={camera} snapshot={objects} doc={doc} onCreated={tool.toolCreated} />
        ) : editable && tool.tool === 'pen' ? (
          <PenTool camera={camera} color={pen.color} thickness={pen.thickness} doc={doc} identityId={getLocalUserId()} />
        ) : null
      }
      onPlaceText={placeText}
      onEmptyClick={sel.clear}
      snapshot={objects}
      onMarqueeSelect={(ids) => sel.setMany(ids, true)}
      onCameraChange={setCamera}
      overlay={(ctx) => {
        centerRef.current = ctx.centerWorld;
        return (
        <>
          <ConnectionStatus state={connection} />
          <Toolbar
            onCreateSticky={() => create(ctx.centerWorld())}
            disabled={!editable}
            undo={undo}
            tool={tool.tool}
            onTool={tool.setTool}
            shapeKind={tool.shapeKind}
            onShapeKind={tool.setShapeKind}
          />
          {editable && tool.tool === 'pen' && (
            <PenToolbar color={pen.color} thickness={pen.thickness} onColor={pen.setColor} onThickness={pen.setThickness} />
          )}
          {sel.editingId === null && (
            <SelectionOverlay
              ids={sel.ids}
              snapshot={objects}
              camera={ctx.camera}
              onHandlePointerDown={gesture.onHandlePointerDown}
            />
          )}
          {editable && sel.editingId === null && !gesturing && (
            <SelectionBar
              ids={sel.ids}
              snapshot={objects}
              camera={ctx.camera}
              onDelete={deleteSelection}
              onColor={(id, color) => {
                history.boundary();
                setStickyColor(doc, id, color);
                history.boundary();
              }}
              onShapeStyle={(id, style) => {
                history.boundary();
                setShapeStyle(doc, id, style);
                history.boundary();
              }}
              onTextSize={(id, size) => {
                history.boundary();
                if (setTextSize(doc, id, size)) remeasureText(doc, id, getDefaultMeasurer());
                history.boundary();
              }}
            />
          )}
        </>
        );
      }}
    >
      {(ctx) =>
        // DOM order is stable (by id) and stacking uses z-index: re-ordering nodes mid-drag would drop pointer capture.
        [...objects].sort(byId).map((object) => {
          const spec = getObjectType(object.type);
          if (!spec) return null;
          return (
            <spec.Component
              key={object.id}
              object={object}
              doc={doc}
              zoom={ctx.zoom}
              selected={sel.ids.has(object.id)}
              editing={sel.editingId === object.id}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onStartEdit={sel.startEdit}
              onEndEdit={sel.endEdit}
              readOnly={!editable}
              rects={rects}
            />
          );
        })
      }
    </BoardViewport>
    </UndoContext.Provider>
  );
}
