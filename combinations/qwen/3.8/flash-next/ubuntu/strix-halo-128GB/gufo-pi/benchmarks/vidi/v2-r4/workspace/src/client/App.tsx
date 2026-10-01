import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BoardViewport,
  type ViewportBridge,
} from './canvas/BoardViewport';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import * as Y from 'yjs';
import { createSticky, deleteObject } from '../shared/board-model';
import { newBoardId } from '../shared/board-id';
import { isTestMode, setTestConnectionState } from './testHooks';
import { canEdit } from './sync/connectBoard';
import type { Camera, Point } from './canvas/camera';

/** True when the key press belongs to the focused field, not the board. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Extract boardId from a /b/:boardId pathname.
 */
function extractBoardId(pathname: string): string | null {
  const match = pathname.match(/^\/b\/([^/]+)$/);
  return match ? match[1] : null;
}

/**
 * The board: a navigable infinite canvas (story 1) populated with sticky notes
 * (story 2), with live collaboration (story 3). Selection and editing are local;
 * the notes live in the board document.
 */
export interface AppProps {
  /**
   * Optional board document. Production passes nothing and the app owns one;
   * component tests pass a doc they can also read and mutate.
   */
  doc?: Y.Doc;
  /**
   * Optional boardId to connect to the sync server. If omitted, no connection.
   */
  boardId?: string;
}

export function App({ doc: externalDoc, boardId: propBoardId }: AppProps = {}): React.JSX.Element {
  // If no boardId prop is given, try to extract from URL; generate one if absent
  const [boardId] = useState<string | undefined>(() => {
    if (propBoardId) return propBoardId;
    const fromUrl = extractBoardId(window.location.pathname);
    if (fromUrl) return fromUrl;
    // No boardId in URL: generate one and update the address bar
    const id = newBoardId();
    window.history.replaceState(null, '', `/b/${id}`);
    return id;
  });

  const { doc, notes, connectionState } = useBoardDoc(externalDoc, boardId);
  const isReadOnly = !canEdit(connectionState);

  // Expose connection state for e2e tests
  useEffect(() => {
    if (isTestMode()) {
      setTestConnectionState(connectionState);
    }
  }, [connectionState]);

  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const bridgeRef = useRef<ViewportBridge | null>(null);
  const [zoom, setZoom] = useState(1);
  const onCameraChange = useCallback((camera: Camera) => setZoom(camera.zoom), []);

  /** Centre a new note on a world point, select it and start typing. */
  const createAndEdit = useCallback(
    (world: Point) => {
      if (isReadOnly) return;
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [doc, startEdit, isReadOnly],
  );

  const onCreateStickyWorld = useCallback(
    (world: Point) => {
      createAndEdit(world);
    },
    [createAndEdit],
  );

  /** The toolbar button: a note centred in the visible board area. */
  const onCreateSticky = useCallback(() => {
    const centre = bridgeRef.current?.centreWorld();
    if (!centre) return;
    createAndEdit(centre);
  }, [createAndEdit]);

  const clearSelection = useCallback(() => select(null), [select]);

  const onDeleted = useCallback(
    (id: string) => {
      if (selectedId === id) select(null);
    },
    [selectedId, select],
  );

  // Board keyboard: Enter edits the selected note; Delete/Backspace removes it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (editingId !== null) return;
      if (isTextEntry(event.target)) return;
      if (event.key === 'Enter') {
        if (!selectedId) return;
        event.preventDefault();
        startEdit(selectedId);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selectedId) return;
        if (isReadOnly) return;
        event.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, editingId, selectedId, select, startEdit, isReadOnly]);

  return (
    <div className="app">
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        bridgeRef={bridgeRef}
        onCreateStickyWorld={onCreateStickyWorld}
        onClearSelection={clearSelection}
        onCameraChange={onCameraChange}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={zoom}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
            onDeleted={onDeleted}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={onCreateSticky} />
    </div>
  );
}
