import { useEffect, useMemo, useRef } from 'react';
import { createSticky, deleteObject } from '../../shared/board-model';
import { Toolbar } from './Toolbar';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { BoardViewport } from '../canvas/BoardViewport';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point } from '../canvas/camera';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import { StickyNote } from '../objects/StickyNote';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';

const HALF = 2;
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Editing is blocked only while the saved board could not be loaded (never present an empty editable board). */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}


export function Board({ boardId }: { boardId: string }) {
  const { doc, notes, connection } = useBoardDoc(boardId);
  useEffect(() => {
    if (window.__vidi6) window.__vidi6.connectionState = connection;
  }, [connection]);
  const sel = useSelection();
  const selRef = useRef(sel);
  selRef.current = sel;

  // Stacking is CSS z-index (z, with id as DOM-order tie-break). The DOM order stays stable so that
  // bringToFront never moves a note's element, which would drop its pointer capture mid-drag.
  const domOrder = useMemo(() => [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), [notes]);

  const editable = canEdit(connection);
  const editableRef = useRef(editable);
  editableRef.current = editable;

  const createAt = (world: Point) => {
    if (!editableRef.current) return;
    const id = createSticky(doc, world);
    if (id) sel.startEdit(id);
  };

  // A selected note that no longer exists (deleted here or by a peer later) clears the selection.
  useEffect(() => {
    if (sel.selectedId && !notes.some((n) => n.id === sel.selectedId)) sel.select(null);
  }, [notes, sel]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { selectedId, editingId, startEdit, select } = selRef.current;
      if (!editableRef.current || !selectedId || editingId !== null || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (TEXT_ENTRY_TAGS.has(t.tagName) || t.isContentEditable)) return;
      if (e.key === 'Enter') {
        if (t instanceof HTMLButtonElement) return; // Enter activates the focused button
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc]);

  return (
    <BoardViewport
      onDoubleClickEmpty={createAt}
      onEmptyClick={() => sel.select(null)}
      overlay={(api) => (
        <>
          <Toolbar
            disabled={!editable}
            onCreateSticky={() => createAt(
              screenToWorld(api.getCamera(), { x: api.size.width / HALF, y: api.size.height / HALF }),
            )}
          />
          <ConnectionStatus state={connection} />
          <NavigationHint visible={!api.hasNavigated} />
          <ZoomControls
            zoomPercent={zoomPercent(api.camera)}
            canZoomIn={canZoomIn(api.camera)}
            canZoomOut={canZoomOut(api.camera)}
            onZoomIn={() => api.zoomStep('in')}
            onZoomOut={() => api.zoomStep('out')}
            onReset={api.reset}
          />
        </>
      )}
    >
      {(api) => domOrder.map((note) => (
        <StickyNote
          key={note.id}
          note={note}
          doc={doc}
          zoom={api.camera.zoom}
          selected={sel.selectedId === note.id}
          editing={editable && sel.editingId === note.id}
          readOnly={!editable}
          onSelect={sel.select}
          onStartEdit={sel.startEdit}
          onEndEdit={sel.endEdit}
        />
      ))}
    </BoardViewport>
  );
}
