import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { BoardContext, type BoardContextValue } from './canvas/BoardContext';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point, type Size } from './canvas/camera';
import { useCamera } from './canvas/useCamera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ProviderFactory } from './sync/connectBoard';
import { createSticky, deleteObject } from '../shared/board-model';
import { isValidBoardId, newBoardId } from '../shared/board-id';

const HALF = 2;

function windowSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** True when keyboard focus is somewhere that consumes typing or activation keys. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, select, button, [contenteditable="true"]') !== null;
}

const BOARD_ROUTE = /^\/b\/([^/]+)\/?$/;

/**
 * Reads the board id from `/b/:boardId`. Any other address (including `/`) is replaced
 * by a fresh board address — temporary until story 5 creates boards on the server.
 */
export function resolveBoardRoute(): string {
  const match = BOARD_ROUTE.exec(window.location.pathname);
  const id = match?.[1];
  if (id !== undefined && isValidBoardId(id)) return id;
  const fresh = newBoardId();
  window.history.replaceState(null, '', `/b/${fresh}`);
  return fresh;
}

export interface AppProps {
  /** Board to join live. Omitted: a local-only board (component tests). */
  boardId?: string;
  doc?: Y.Doc;
  createProvider?: ProviderFactory;
}

export function App(props: AppProps = {}): React.JSX.Element {
  const [viewport, setViewport] = useState<Size>(windowSize);
  const board = useCamera(viewport);
  const context = useMemo<BoardContextValue>(() => ({ board, setViewport }), [board]);
  const { camera } = board;
  const { doc, notes, connection } = useBoardDoc({
    boardId: props.boardId,
    doc: props.doc,
    createProvider: props.createProvider,
  });
  const selection = useSelection();
  // DOM order never changes when a note is brought to front (moving a DOM node would drop
  // its pointer capture mid-drag); stacking comes from each note's z-index instead.
  const renderOrder = useMemo(() => [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), [notes]);
  const { select, startEdit, endEdit } = selection;

  // A note that no longer exists (deleted here or, later, by someone else) cannot stay selected.
  const selectedExists = selection.selectedId !== null && notes.some((n) => n.id === selection.selectedId);
  const selectedId = selectedExists ? selection.selectedId : null;
  const editingId = selectedExists && selection.editingId === selectedId ? selection.editingId : null;
  useEffect(() => {
    if (selection.selectedId !== null && !selectedExists) select(null);
  }, [selection.selectedId, selectedExists, select]);

  const createAt = useCallback(
    (world: Point) => {
      const id = createSticky(doc, world);
      if (id !== '') startEdit(id);
    },
    [doc, startEdit],
  );

  const onCreateSticky = useCallback(() => {
    createAt(screenToWorld(camera, { x: viewport.width / HALF, y: viewport.height / HALF }));
  }, [camera, viewport, createAt]);

  const onBackgroundClick = useCallback(() => select(null), [select]);

  // Enter edits the selected note; Delete/Backspace delete it (never while editing text).
  const keyState = useRef({ selectedId, editingId });
  keyState.current = { selectedId, editingId };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { selectedId: sel, editingId: edit } = keyState.current;
      if (sel === null || edit !== null || e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isInteractiveTarget(e.target)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        startEdit(sel);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteObject(doc, sel);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, select, startEdit]);

  return (
    <BoardContext.Provider value={context}>
      <main className="app">
        <BoardViewport onBackgroundClick={onBackgroundClick} onBackgroundDoubleClick={createAt}>
          {renderOrder.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={camera.zoom}
              selected={note.id === selectedId}
              editing={note.id === editingId}
              onSelect={select}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
            />
          ))}
        </BoardViewport>
        <Toolbar onCreateSticky={onCreateSticky} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => board.zoomStep('in')}
          onZoomOut={() => board.zoomStep('out')}
          onReset={board.reset}
        />
        <NavigationHint visible={!board.hasNavigated} />
        <ConnectionStatus state={connection} />
      </main>
    </BoardContext.Provider>
  );
}
