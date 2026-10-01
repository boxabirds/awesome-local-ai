import { useEffect, useRef, useState } from 'react';
import { STICKY_SIZE_WORLD } from '../shared/config';
import { createSticky, deleteObject, setStickyColor } from '../shared/board-model';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { worldToScreen } from './canvas/camera';
import type { Point } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { NoteToolbar } from './objects/NoteToolbar';
import { StickyNote } from './objects/StickyNote';

const NOTE_TOOLBAR_GAP_PX = 10;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Editing is blocked only while the saved board cannot be loaded (never present it as an empty editable board). */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function App({ boardId }: { boardId?: string } = {}) {
  const { doc, notes, connection } = useBoardDoc(boardId);
  const sel = useSelection();
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const editable = canEdit(connection);
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const selRef = useRef(sel);
  selRef.current = sel;

  // A note that vanished (deleted by this or another client) can no longer be selected or edited.
  useEffect(() => {
    if (sel.selectedId && !notes.some((n) => n.id === sel.selectedId)) sel.select(null);
    if (sel.editingId && !notes.some((n) => n.id === sel.editingId)) sel.select(null);
    setDraggingId((d) => (d && !notes.some((n) => n.id === d) ? null : d));
  }, [notes, sel]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { selectedId, editingId } = selRef.current;
      if (!editableRef.current || !selectedId || editingId !== null || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Enter') {
        if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
        e.preventDefault();
        selRef.current.startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteObject(doc, selectedId);
        selRef.current.select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc]);

  const create = (at: Point) => {
    if (!editable) return;
    const id = createSticky(doc, at);
    if (id) sel.startEdit(id);
  };

  const selected = notes.find((n) => n.id === sel.selectedId);

  return (
    <BoardViewport
      onCreateAt={create}
      onEmptyClick={() => sel.select(null)}
      overlay={(ctx) => (
        <>
          <ConnectionStatus state={connection} />
          <Toolbar onCreateSticky={() => create(ctx.centerWorld())} disabled={!editable} />
          {editable && selected && sel.editingId === null && draggingId === null && (
            <div
              className="note-toolbar-anchor"
              style={(() => {
                const p = worldToScreen(ctx.camera, { x: selected.x, y: selected.y });
                const w = STICKY_SIZE_WORLD * ctx.zoom;
                return { left: p.x + w / 2, top: p.y - NOTE_TOOLBAR_GAP_PX };
              })()}
            >
              <NoteToolbar
                color={selected.color}
                onColor={(c) => setStickyColor(doc, selected.id, c)}
                onDelete={() => {
                  deleteObject(doc, selected.id);
                  sel.select(null);
                }}
              />
            </div>
          )}
        </>
      )}
    >
      {(ctx) =>
        // DOM order is stable (by id) and stacking uses z-index: re-ordering nodes mid-drag would drop pointer capture.
        [...notes].sort(byId).map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={ctx.zoom}
            selected={sel.selectedId === note.id}
            editing={sel.editingId === note.id}
            onSelect={sel.select}
            onStartEdit={sel.startEdit}
            onEndEdit={sel.endEdit}
            onDragChange={(d) => setDraggingId(d ? note.id : null)}
            readOnly={!editable}
          />
        ))
      }
    </BoardViewport>
  );
}
