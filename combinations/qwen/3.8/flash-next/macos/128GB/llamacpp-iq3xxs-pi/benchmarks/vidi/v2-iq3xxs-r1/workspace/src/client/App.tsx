import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BoardCameraProvider,
  BoardViewport,
  useBoardCamera,
} from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import {
  canZoomIn as camCanZoomIn,
  canZoomOut as camCanZoomOut,
  screenToWorld,
  zoomPercent,
  type Point,
} from './canvas/camera';
import { patchTestHook, unpatchTestHook } from './canvas/testHooks';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectOptions, ProviderLike } from './sync/connectBoard';
import { newBoardId } from '../shared/board-id';
import { createSticky, deleteObject, snapshot } from '../shared/board-model';

function ZoomControlsConnector() {
  const { camera, zoomStep, reset } = useBoardCamera();
  return (
    <ZoomControls
      zoomPercent={zoomPercent(camera)}
      canZoomIn={camCanZoomIn(camera)}
      canZoomOut={camCanZoomOut(camera)}
      onZoomIn={() => zoomStep('in')}
      onZoomOut={() => zoomStep('out')}
      onReset={reset}
    />
  );
}

function NavigationHintConnector() {
  const { hasNavigated } = useBoardCamera();
  return <NavigationHint visible={!hasNavigated} />;
}

/** True when the keyboard belongs to a text field, not to the board. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * The board: the document, the local selection, the object layer inside the
 * transformed world, the toolbars outside it, and the board-level keyboard.
 */
interface BoardProps {
  readonly boardId: string;
  /** Component tests render a board with no network at all. */
  readonly sync: boolean;
  /** Fake provider / clock for the connection status component tests. */
  readonly provider?: ProviderLike;
  readonly connect?: ConnectOptions;
}

function Board({ boardId, sync, provider, connect }: BoardProps) {
  const { doc, notes, connection, connectionState } = useBoardDoc(boardId, {
    sync,
    provider,
    connect,
  });
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const selection = useSelection();
  const { camera, viewport } = useBoardCamera();
  const { select, startEdit, endEdit, selectedId, editingId } = selection;

  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // A note that is gone — deleted here, or deleted on another screen and removed
  // from the document by the sync — cannot stay selected or stay open for editing:
  // its toolbar and its editor disappear with it (PRD live.delete_during_edit).
  useEffect(() => {
    const { selectedId: selected, editingId: editing } = selectionRef.current;
    if (selected !== null && !notes.some((n) => n.id === selected)) select(null);
    if (editing !== null && !notes.some((n) => n.id === editing)) select(null);
  }, [notes, selectedId, editingId, select]);

  /** Create a note centred on a screen-space point, and start typing it. */
  const createAtScreenPoint = useCallback(
    (point: Point) => {
      const world = screenToWorld(camera, point);
      const id = createSticky(doc, world);
      if (id) startEdit(id); // yellow, on top, editing active
    },
    [camera, doc, startEdit],
  );

  const onCreateSticky = useCallback(
    () => createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 }),
    [createAtScreenPoint, viewport],
  );

  // ------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // While a note is being edited (or any text field has focus) the keys
      // belong to the text: Backspace and Delete must never remove the note.
      if (isTextEntry(event.target) || selectionRef.current.editingId) return;
      const id = selectionRef.current.selectedId;
      if (!id) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        startEdit(id);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObject(doc, id);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, select, startEdit]);

  // --------------------------------------------------- test-only inspection
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    patchTestHook({
      getDoc: () => doc,
      getSnapshot: () => snapshot(doc),
      getSelection: () => ({
        selectedId: selectionRef.current.selectedId,
        editingId: selectionRef.current.editingId,
      }),
      // Nightly TC-29 reads this: the badge text is the UI, this is the state.
      getConnectionState: () => connectionState,
      // The browser tests cannot unplug a socket from the outside, so they ask
      // for a real close (and a real reconnect) through the same provider.
      dropConnection: () => connectionRef.current?.dropConnection(),
      resumeConnection: () => connectionRef.current?.resumeConnection(),
    });
    return () =>
      unpatchTestHook([
        'getDoc',
        'getSnapshot',
        'getSelection',
        'getConnectionState',
        'dropConnection',
        'resumeConnection',
      ]);
  }, [doc, connectionState]);

  const onSelect = useCallback((id: string) => select(id), [select]);
  const onStartEdit = useCallback((id: string) => startEdit(id), [startEdit]);
  const onEndEdit = useCallback((next: 'selected' | 'unselected') => endEdit(next), [endEdit]);

  return (
    <>
      <BoardViewport
        onCreateStickyAt={createAtScreenPoint}
        onEmptyClick={() => select(null)}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            onSelect={onSelect}
            onStartEdit={onStartEdit}
            onEndEdit={onEndEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={onCreateSticky} />
      <ConnectionStatus state={connectionState} />
    </>
  );
}

export interface AppProps {
  /**
   * Which board to join. `main.tsx` passes the id from the URL; component tests
   * pass their own. Omit it and a fresh one is made for you.
   */
  boardId?: string;
  /**
   * Connect to the room. False renders the board with no network at all, which is
   * what the jsdom component tests want: they test the board, not the socket.
   */
  sync?: boolean;
  /** Provider override for the connection status tests (TC-19..TC-21). */
  provider?: ProviderLike;
  /** Connection seams (fake clock / provider) used by those same tests. */
  connect?: ConnectOptions;
}

export function App({ boardId, sync = true, provider, connect }: AppProps = {}) {
  // Stable for the lifetime of this page: leaving a board means navigating.
  const [resolvedBoardId] = useState(() => boardId ?? newBoardId());
  return (
    <BoardCameraProvider>
      <Board boardId={resolvedBoardId} sync={sync} provider={provider} connect={connect} />
      <ZoomControlsConnector />
      <NavigationHintConnector />
    </BoardCameraProvider>
  );
}
