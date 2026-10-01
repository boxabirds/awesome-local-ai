import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as Y from 'yjs';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { createSticky, deleteObject } from '../shared/board-model';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { BoardViewport } from './canvas/BoardViewport';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point, type Size } from './canvas/camera';
import { NavigationHint } from './canvas/NavigationHint';
import { installTestHooks } from './canvas/testHooks';
import { useCamera } from './canvas/useCamera';
import { ZoomControls } from './canvas/ZoomControls';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function boardIdFromPath(pathname: string): string | null {
  const match = /^\/b\/([^/]+)\/?$/.exec(pathname);
  return match && isValidBoardId(match[1]) ? match[1] : null;
}

/**
 * Routes `/b/:boardId` to a live board. `/` (and anything else) redirects to a fresh board
 * until story 5 adds server-side creation. A caller-supplied `doc` is edited locally only.
 */
export function App({ doc: externalDoc }: { doc?: Y.Doc } = {}) {
  const boardId = externalDoc ? undefined : boardIdFromPath(window.location.pathname);
  useEffect(() => {
    if (!externalDoc && !boardId) window.location.replace(`/b/${newBoardId()}`);
  }, [externalDoc, boardId]);
  if (!externalDoc && !boardId) return null;
  return <Board doc={externalDoc} boardId={boardId ?? undefined} />;
}

function Board({ doc: externalDoc, boardId }: { doc?: Y.Doc; boardId?: string }) {
  const [size, setSize] = useState<Size>(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const controller = useCamera(size);
  const { camera, setCamera } = controller;
  const { doc, notes, connectionState } = useBoardDoc(externalDoc, boardId);
  const selection = useSelection();
  const { selectedId, editingId, select, startEdit, endEdit } = selection;

  const domOrder = useMemo(
    () => [...notes].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)),
    [notes],
  );
  const stackIndex = useMemo(() => new Map(notes.map((n, i) => [n.id, i + 1])), [notes]);

  useEffect(() => installTestHooks(setCamera), [setCamera]);
  useEffect(() => {
    if (window.__vidi6) window.__vidi6.connectionState = connectionState;
  }, [connectionState]);

  // A note removed (possibly by someone else) while selected or edited ends the interaction silently.
  useEffect(() => {
    const gone = (id: string | null) => id !== null && !notes.some((n) => n.id === id);
    if (gone(selectedId) || gone(editingId)) select(null);
  }, [notes, selectedId, editingId, select]);

  const createAt = useCallback((world: Point) => {
    const id = createSticky(doc, world);
    if (id) startEdit(id);
  }, [doc, startEdit]);

  const createAtCentre = () => {
    createAt(screenToWorld(camera, { x: size.width / 2, y: size.height / 2 }));
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (selectedId === null || editingId !== null || isTextTarget(e.target)) return;
      if (e.key === 'Enter') {
        if (e.target instanceof HTMLButtonElement) return;
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
  }, [doc, selectedId, editingId, select, startEdit]);

  return (
    <>
      <BoardViewport
        controller={controller}
        onResize={setSize}
        onBoardDoubleClick={createAt}
        onBoardClick={() => select(null)}
      >
        {/* Stable DOM order with z-index for stacking: moving a node in the DOM would drop pointer capture mid-drag. */}
        {domOrder.map((note) => (
          <StickyNote
            key={note.id}
            stackIndex={stackIndex.get(note.id)}
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
      <ConnectionStatus state={connectionState} />
      <NavigationHint visible={!controller.hasNavigated} />
      <Toolbar onCreateSticky={createAtCentre} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => controller.zoomStep('in')}
        onZoomOut={() => controller.zoomStep('out')}
        onReset={controller.reset}
      />
    </>
  );
}
