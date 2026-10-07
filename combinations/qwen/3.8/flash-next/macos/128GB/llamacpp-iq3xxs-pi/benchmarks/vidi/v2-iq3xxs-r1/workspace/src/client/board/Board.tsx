import { useCallback, useEffect, useRef } from 'react';
import {
  BoardCameraProvider,
  BoardViewport,
  useBoardCamera,
} from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import {
  canZoomIn as camCanZoomIn,
  canZoomOut as camCanZoomOut,
  screenToWorld,
  zoomPercent,
  type Point,
} from '../canvas/camera';
import { patchTestHook, unpatchTestHook } from '../canvas/testHooks';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { useTransformGesture } from './useTransformGesture';
import { useBoardKeys } from './useBoardKeys';
import { useMarquee, MarqueeRect } from './Marquee';
import { SelectionOverlay } from './SelectionOverlay';
import { SelectionBar } from './SelectionBar';
import { Toolbar } from './Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit, type ConnectOptions, type ProviderLike } from '../sync/connectBoard';
import { SharePanel } from '../share/SharePanel';
import {
  createSticky,
  getStickyText,
  snapshot,
  deleteObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';

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

export interface BoardProps {
  readonly boardId: string;
  readonly sync?: boolean;
  readonly provider?: ProviderLike;
  readonly connect?: ConnectOptions;
}

/**
 * The board: document, selection, objects, toolbars, connection status, share panel,
 * keyboard, transform gestures and marquee selection.
 */
export function Board(props: BoardProps) {
  return (
    <BoardCameraProvider>
      <BoardInside {...props} />
      <ZoomControlsConnector />
      <NavigationHintConnector />
    </BoardCameraProvider>
  );
}

function BoardInside({ boardId, sync = true, provider, connect }: BoardProps) {
  const { doc, notes, connection, connectionState } = useBoardDoc(boardId, {
    sync,
    provider,
    connect,
  });
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const { camera, viewport } = useBoardCamera();
  const editable = canEdit(connectionState);

  // Selection now takes the snapshot so it can prune deleted ids
  const selection = useSelection(notes as unknown as readonly ObjectSnapshot[]);
  const { ids: selectedIds, editingId, click, setMany, clear, startEdit, endEdit } = selection;

  // Transform gesture: group move and resize
  const transformGesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes as unknown as readonly ObjectSnapshot[],
    canEdit: editable,
  });

  // Marquee selection
  const marquee = useMarquee(
    camera,
    notes as unknown as readonly ObjectSnapshot[],
    useCallback((ids: string[]) => setMany(ids, true), [setMany]),
  );

  // Keyboard commands
  useBoardKeys({
    doc,
    selection,
    snapshot: notes as unknown as readonly ObjectSnapshot[],
    canEdit: editable,
  });

  // Enter to edit a single selected sticky (kept from story 2)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!editable) return;
      if (selection.editingId) return;
      const target = event.target as HTMLElement;
      if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (selectedIds.size === 1) {
        const id = [...selectedIds][0];
        const note = notes.find((n) => n.id === id);
        if (note && note.type === 'sticky') {
          event.preventDefault();
          startEdit(id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editable, selectedIds, notes, startEdit]);

  /** Create a note centred on a screen-space point, and start typing it. */
  const createAtScreenPoint = useCallback(
    (point: Point) => {
      if (!editable) return;
      const world = screenToWorld(camera, point);
      const id = createSticky(doc, world);
      if (id) {
        clear();
        startEdit(id);
      }
    },
    [camera, doc, editable, clear, startEdit],
  );

  const onCreateSticky = useCallback(
    () => createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 }),
    [createAtScreenPoint, viewport],
  );

  // --------------------------------------------------- test-only inspection
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    patchTestHook({
      getDoc: () => doc,
      getSnapshot: () => snapshot(doc),
      getSelection: (): { selectedId: string | null; editingId: string | null; selectedIds?: string[] } => {
        const ids = [...selectedIds];
        const base: { selectedId: string | null; editingId: string | null; selectedIds?: string[] } = {
          selectedId: ids.length === 1 ? ids[0] : null,
          editingId: editingId,
        };
        if (ids.length > 1) base.selectedIds = ids;
        return base;
      },
      getConnectionState: () => connectionState,
      dropConnection: () => connectionRef.current?.dropConnection(),
      resumeConnection: () => connectionRef.current?.resumeConnection(),
      seedBoard: (count: number) => {
        doc.transact(() => {
          for (let i = 0; i < count; i++) {
            const id = createSticky(doc, { x: (i % 50) * 230, y: Math.floor(i / 50) * 230 });
            if (id) getStickyText(doc, id)?.insert(0, `note ${i + 1} of ${count}`);
          }
        });
      },
    });
    return () =>
      unpatchTestHook([
        'getDoc',
        'getSnapshot',
        'getSelection',
        'getConnectionState',
        'dropConnection',
        'resumeConnection',
        'seedBoard',
      ]);
  }, [doc, connectionState, selectedIds, editingId]);

  const onSelect = useCallback((id: string) => click(id), [click]);
  const onStartEdit = useCallback((id: string) => startEdit(id), [startEdit]);
  const onEndEdit = useCallback((next: 'selected' | 'unselected') => {
    if (next === 'unselected') clear();
    else endEdit();
  }, [clear, endEdit]);

  const onDeleteSelection = useCallback(() => {
    if (!editable) return;
    deleteObjects(doc, [...selectedIds]);
    clear();
  }, [doc, selectedIds, clear, editable]);

  // Selection overlay handles
  const onHandlePointerDown = transformGesture.onHandlePointerDown;

  // Empty click clears selection (only when not editing)
  const onEmptyClick = useCallback(() => {
    clear();
  }, [clear]);

  return (
    <div data-testid="board" data-board-id={boardId}>
      <BoardViewport
        onCreateStickyAt={createAtScreenPoint}
        onEmptyClick={onEmptyClick}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            editable={editable}
            selected={selectedIds.has(note.id)}
            editing={editingId === note.id}
            dragging={transformGesture.draggingIds.has(note.id)}
            onSelect={onSelect}
            onStartEdit={onStartEdit}
            onEndEdit={onEndEdit}
            onObjectPointerDown={transformGesture.onObjectPointerDown}
          />
        ))}
      </BoardViewport>

      {/* Selection overlay: bounding box + handles */}
      {selectedIds.size > 0 && (
        <SelectionOverlay
          ids={selectedIds}
          snapshot={notes as unknown as readonly ObjectSnapshot[]}
          camera={camera}
          onHandlePointerDown={onHandlePointerDown}
        />
      )}

      {/* Marquee rectangle (screen space) */}
      <MarqueeRect rect={marquee.rect} camera={camera} />

      {/* Selection bar (>= 2 selected) */}
      <SelectionBar
        ids={selectedIds}
        snapshot={notes as unknown as readonly ObjectSnapshot[]}
        onDelete={onDeleteSelection}
      />

      <Toolbar onCreateSticky={onCreateSticky} disabled={!editable} />
      <ConnectionStatus state={connectionState} />
      <SharePanel boardId={boardId} />
    </div>
  );
}
