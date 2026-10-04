/**
 * The live board for one board id (stories 1–4): document, selection state,
 * toolbar, sticky notes, connection badge, and keyboard shortcuts.
 *
 * Moved out of App.tsx in story 5, which made App.tsx the router and this
 * the component the Board page mounts once the board exists.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { BoardViewport } from '../canvas/BoardViewport';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { Toolbar } from './Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { NoteToolbar } from '../objects/NoteToolbar';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../sync/connectBoard';
import { reportConnectionState } from '../canvas/testHooks';
import { createSticky, deleteObject, setStickyColor } from '../../shared/board-model';
import { STICKY_SIZE_WORLD } from '../../shared/config';

/**
 * The live board for one board id: document, selection state, toolbar,
 * sticky notes, connection badge, and keyboard shortcuts.
 */
export function Board({ boardId }: { boardId: string }): JSX.Element {
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit, prune } = useSelection();
  // Editing is locked only while the board failed to load (close code 4500).
  const editable = canEdit(connectionState);

  // Publish the mapped state for long-running e2e tests (test builds only).
  useEffect(() => {
    reportConnectionState(connectionState);
  }, [connectionState]);

  // When a note disappears (e.g. deleted by someone else while we were
  // typing in or dragging it), clear our selection/editing for it.
  useEffect(() => {
    prune(new Set(notes.map((n) => n.id)));
  }, [notes, prune]);

  // Camera ref updated by BoardViewport via onCameraChange callback
  const cameraRef = useRef({ x: -640, y: -400, zoom: 1 });

  const onDblClickEmpty = useCallback(
    (screenPoint: { x: number; y: number }) => {
      if (!editable) return;
      const cam = cameraRef.current;
      const world = screenToWorld(cam, screenPoint);
      const id = createSticky(doc, world);
      if (id) {
        startEdit(id);
      }
    },
    [doc, startEdit, editable],
  );

  const onClickEmpty = useCallback(() => {
    select(null);
  }, [select]);

  const onCreateSticky = useCallback(() => {
    if (!editable) return;
    const cam = cameraRef.current;
    // Centre of the visible board area (viewport is 1280x800 default)
    const centre = { x: 640, y: 400 };
    const world = screenToWorld(cam, centre);
    const id = createSticky(doc, world);
    if (id) {
      startEdit(id);
    }
  }, [doc, startEdit, editable]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'Enter' && selectedId && !editingId) {
        if (!editable) return;
        e.preventDefault();
        startEdit(selectedId);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId) {
        if (!editable) return;
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, editingId, doc, startEdit, select, editable]);

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        onDblClickEmpty={onDblClickEmpty}
        onClickEmpty={onClickEmpty}
        onCameraChange={(cam) => { cameraRef.current = cam; }}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={cameraRef.current.zoom}
            canEdit={editable}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={onCreateSticky} disabled={!editable} />
      {selectedId && !editingId && (() => {
        const selNote = notes.find(n => n.id === selectedId);
        if (!selNote) return null;
        const cam = cameraRef.current;
        const screen = worldToScreen(cam, { x: selNote.x, y: selNote.y });
        return (
          <div style={{ position: 'fixed', left: screen.x + (STICKY_SIZE_WORLD / 2) * cam.zoom, top: screen.y + STICKY_SIZE_WORLD * cam.zoom + 8, transform: 'translateX(-50%)', zIndex: 1000 }}>
            <NoteToolbar
              color={selNote.color}
              onColor={(c) => { if (editable) setStickyColor(doc, selectedId, c); }}
              onDelete={() => {
                if (!editable) return;
                deleteObject(doc, selectedId);
                select(null);
              }}
            />
          </div>
        );
      })()}
    </>
  );
}
