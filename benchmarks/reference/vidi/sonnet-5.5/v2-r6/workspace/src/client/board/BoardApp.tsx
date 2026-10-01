import { useRef } from 'react';
import { createSticky, deleteObjects, setStickyColor } from '../../shared/board-model';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { SelectionBar } from './SelectionBar';
import { SelectionOverlay } from './SelectionOverlay';
import { Toolbar } from './Toolbar';
import { useBoardDoc, type BoardDoc } from './useBoardDoc';
import { useBoardKeys } from './useBoardKeys';
import { useSelection } from './useSelection';
import { useTransformGesture } from './useTransformGesture';
import { BoardViewport } from '../canvas/BoardViewport';
import type { Camera, Point } from '../canvas/camera';
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

  const editable = canEdit(board.connection);
  const gesture = useTransformGesture({
    doc, camera: cameraRef, selection: sel, snapshot: notes, canEdit: editable,
  });
  useBoardKeys({ doc, selection: sel, snapshot: notes, canEdit: editable });

  const create = (centre: Point) => {
    if (!editable) return;
    const id = createSticky(doc, centre);
    if (id) startEdit(id);
  };

  const deleteSelection = () => {
    if (!editable) return;
    deleteObjects(doc, [...ids]);
    sel.clear();
  };

  // DOM order is stable (by id) so pointer capture survives restacking; z-index does the stacking.
  const domOrder = [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const moving = gesture.active === 'move';

  return (
    <>
    {board.connection && <ConnectionStatus state={board.connection} />}
    <BoardViewport
      cameraRef={cameraRef}
      snapshot={notes}
      onMarqueeSelect={(found) => sel.setMany(found, true)}
      onEmptyDoubleClick={create}
      onEmptyClick={sel.clear}
      overlay={(ctx) => (
        <>
          <Toolbar disabled={!editable} onCreateSticky={() => create(ctx.centreWorld())} />
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
              onColor={(id, c) => { setStickyColor(doc, id, c); }}
            />
          )}
        </>
      )}
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
            onObjectPointerDown={gesture.onObjectPointerDown}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        );
      })}
    </BoardViewport>
    </>
  );
}
