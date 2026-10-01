import { useMemo, useRef } from 'react';
import { createSticky, deleteObjects, objectBounds, setStickyColor } from '../../shared/board-model';
import type { Rect } from '../../shared/geometry';
import { setShapeStyle } from '../../shared/objects/shape';
import { ConnectorTool } from '../tools/ConnectorTool';
import { PenTool } from '../tools/PenTool';
import { PenToolbar } from '../tools/PenToolbar';
import { ShapeTool } from '../tools/ShapeTool';
import { usePenOptions } from '../tools/usePenOptions';
import { useActiveTool } from '../tools/useActiveTool';
import { createText, setTextSize } from '../../shared/objects/text';
import { defaultMeasurer } from '../objects/textLayout';
import { remeasureText } from '../objects/useTextBoxSync';
import { localIdentityId } from './identity';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { SelectionBar } from './SelectionBar';
import { SelectionOverlay } from './SelectionOverlay';
import { Toolbar } from './Toolbar';
import { useBoardDoc, type BoardDoc } from './useBoardDoc';
import { UndoButtons } from './UndoButtons';
import { useBoardKeys } from './useBoardKeys';
import { UndoContext, useCreateUndo, useUndo } from './useUndo';
import { useSelection } from './useSelection';
import { useTransformGesture } from './useTransformGesture';
import { BoardViewport } from '../canvas/BoardViewport';
import type { Camera, Point } from '../canvas/camera';
import type { TextSize } from '../../shared/config';
import { getObjectType } from '../objects/registry';

/** False only while the saved board could not be loaded: it must not look like an empty editable board. */
export function canEdit(state: ConnectionState | undefined): boolean {
  return state !== 'load_failed';
}

export function ConnectedBoard({ boardId }: { boardId: string }) {
  return <BoardApp board={useBoardDoc(boardId)} />;
}

/** The board UI over an existing document (tests supply their own to poke the model). */
export function BoardApp({ board }: { board: BoardDoc }) {
  const { doc, notes } = board;
  const sel = useSelection(notes);
  const { ids, editingId, startEdit, endEdit } = sel;
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const centreRef = useRef<() => Point>(() => ({ x: 0, y: 0 }));

  const editable = canEdit(board.connection);
  const undo = useCreateUndo(doc);
  const undoState = useUndo(undo, editable);
  const boundary = () => undo?.boundary();
  const gesture = useTransformGesture({
    doc, camera: cameraRef, selection: sel, snapshot: notes, canEdit: editable,
    onGestureStart: () => { undo?.boundary(); undo?.hold?.(true); },
    onGestureEnd: () => { undo?.hold?.(false); undo?.boundary(); },
  });
  const { tool, setTool, shapeKind, setShapeKind, toolCreated } = useActiveTool({ canEdit: editable, select: sel.select });
  const pen = usePenOptions();
  // Arrows redraw from these on every snapshot, so moves and resizes by anyone move them too.
  const rects = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const o of notes) if (o.type !== 'connector') m.set(o.id, objectBounds(o));
    return m;
  }, [notes]);

  const create = (centre: Point) => {
    if (!editable) return;
    boundary();
    const id = createSticky(doc, centre);
    boundary();
    if (id) startEdit(id);
  };

  const createTextAt = (world: Point) => {
    if (!editable) return;
    boundary();
    const id = createText(doc, world, localIdentityId());
    if (!id) return;
    setTool('select');
    startEdit(id);
  };

  const changeTextSize = (id: string, size: TextSize) => {
    boundary();
    if (setTextSize(doc, id, size)) remeasureText(doc, id, defaultMeasurer());
    boundary();
  };

  useBoardKeys({
    doc, selection: sel, snapshot: notes, canEdit: editable, undo,
    tool, setTool, onCreateSticky: () => create(centreRef.current()),
  });

  const deleteSelection = () => {
    if (!editable) return;
    boundary();
    deleteObjects(doc, [...ids]);
    boundary();
    sel.clear();
  };

  // DOM order is stable (by id) so pointer capture survives restacking; z-index does the stacking.
  const domOrder = [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const moving = gesture.active === 'move';

  return (
    <UndoContext.Provider value={undo}>
    {board.connection && <ConnectionStatus state={board.connection} />}
    <BoardViewport
      cameraRef={cameraRef}
      snapshot={notes}
      onMarqueeSelect={(found) => sel.setMany(found, true)}
      onEmptyDoubleClick={create}
      onEmptyClick={sel.clear}
      tool={tool}
      onTextToolClick={createTextAt}
      overlay={(ctx) => {
        centreRef.current = ctx.centreWorld;
        return (
        <>
          <Toolbar
            disabled={!editable}
            tool={tool}
            onTool={setTool}
            shapeKind={shapeKind}
            onShapeKind={setShapeKind}
            onCreateSticky={() => create(ctx.centreWorld())}
          >
            <UndoButtons {...undoState} />
          </Toolbar>
          {tool === 'shape' && (
            <ShapeTool kind={shapeKind} camera={ctx.camera} doc={doc} onCreated={toolCreated} />
          )}
          {tool === 'pen' && (
            <>
              <PenToolbar color={pen.color} thickness={pen.thickness} onColor={pen.setColor} onThickness={pen.setThickness} />
              <PenTool camera={ctx.camera} color={pen.color} thickness={pen.thickness} doc={doc} identityId={localIdentityId()} />
            </>
          )}
          {tool === 'connector' && (
            <ConnectorTool camera={ctx.camera} snapshot={notes} doc={doc} onCreated={toolCreated} />
          )}
          {editingId === null && (
            <SelectionOverlay
              ids={ids}
              snapshot={notes}
              camera={ctx.camera}
              readOnly={!editable}
              onHandlePointerDown={gesture.onHandlePointerDown}
            />
          )}
          {editingId === null && gesture.active === null && editable && (
            <SelectionBar
              ids={ids}
              snapshot={notes}
              camera={ctx.camera}
              onDelete={deleteSelection}
              onColor={(id, c) => { boundary(); setStickyColor(doc, id, c); boundary(); }}
              onSize={changeTextSize}
              onShapeStyle={(id, style) => { boundary(); setShapeStyle(doc, id, style); boundary(); }}
            />
          )}
        </>
        );
      }}
    >
      {(ctx) => domOrder.map((note) => {
        const Component = getObjectType(note.type)?.Component;
        if (!Component) return null;
        const selected = ids.has(note.id);
        return (
          <Component
            key={note.id}
            object={note}
            doc={doc}
            zoom={ctx.camera.zoom}
            selected={selected}
            editing={note.id === editingId}
            dragging={moving && selected}
            readOnly={!editable}
            rects={rects}
            onObjectPointerDown={gesture.onObjectPointerDown}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        );
      })}
    </BoardViewport>
    </UndoContext.Provider>
  );
}
