import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { checkBoard } from '../api';
import { BoardViewport } from '../canvas/BoardViewport';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';
import { registerVidi6Hook, type NoteSpec } from '../canvas/testHooks';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { useTransformGesture } from '../board/useTransformGesture';
import { useBoardKeys } from '../board/useBoardKeys';
import { useUndo } from '../board/useUndo';
import { createUndo, type UndoController } from '../board/undo';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { Toolbar } from '../board/Toolbar';
import { UndoButtons } from '../board/UndoButtons';
import { getObjectType } from '../objects/registry';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { createSticky, deleteObjects, getStickyText } from '../../shared/board-model';
import { isValidBoardId } from '../../shared/board-id';
import { SharePanel } from '../share/SharePanel';
import { nextBoardPageState, type BoardPageState } from './state';
import { NotFoundPage } from './NotFoundPage';

const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/**
 * The board UI (stories 1–5), mounted only when the board page has confirmed
 * the board exists (share.open_link: full editing, no sign-in).
 *
 * Story 7 wires the multi-selection machinery: Set-based selection
 * (useSelection), Shift+drag marquee (useMarquee), the generic transform
 * gesture (useTransformGesture: group move + bounding-box resize), the
 * screen-space overlay (SelectionOverlay) and bar (SelectionBar), and the
 * keyboard commands (useBoardKeys). Objects render through the type
 * registry (unknown types are skipped).
 *
 * `canEdit` is true whenever the board is mounted: the load-failed state
 * (story 4) shows the retry page instead of the board, so a mounted board is
 * always editable (PRD persist alternate flow).
 */
export function Board({ boardId, canEdit = true }: { boardId: string; canEdit?: boolean }): JSX.Element {
  const { doc, objects, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(objects);
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);
  const cameraRef = useRef<Camera>(INITIAL_CAMERA);

  const handleCamera = useCallback((cam: Camera) => {
    cameraRef.current = cam;
    setCamera(cam);
  }, []);

  // Story 8: one undo controller per board doc, destroyed on unmount.
  const undoRef = useRef<UndoController | null>(null);
  if (undoRef.current === null) {
    undoRef.current = createUndo(doc);
  }
  const undoController = undoRef.current;
  useEffect(() => {
    return () => {
      undoRef.current?.destroy();
      undoRef.current = null;
    };
  }, []);
  const undo = useUndo(undoController, canEdit);

  const gesture = useTransformGesture({
    doc, camera, selection, snapshot: objects, canEdit,
    onGestureStart: () => undoController.boundary(),
    onGestureEnd: () => undoController.boundary(),
  });
  useBoardKeys({ doc, selection, snapshot: objects, canEdit, undo: undoController });
  const marquee = useMarquee(camera, objects, (ids) => selection.setMany(ids, true));

  // Test hook for e2e (drives the production build via `wrangler dev`)
  useEffect(() => {
    registerVidi6Hook({
      getDoc: () => doc,
      createNotes: (n: number) => {
        const ids: string[] = [];
        for (let i = 0; i < n; i++) {
          const x = 200 + (i % 20) * 220;
          const y = 200 + Math.floor(i / 20) * 220;
          const id = createSticky(doc, { x, y }, 'yellow');
          if (id) ids.push(id);
        }
        return ids;
      },
      createNotesAt: (specs: NoteSpec[]) => {
        const ids: string[] = [];
        for (const s of specs) {
          const id = createSticky(doc, { x: s.x, y: s.y }, (s.color as 'yellow') ?? 'yellow');
          if (s.text) getStickyText(doc, id)?.insert(0, s.text);
          if (id) ids.push(id);
        }
        return ids;
      },
    });
    // Expose connection state for nightly tests
    (window as any).__vidi6 = {
      ...(window as any).__vidi6,
      connectionState,
    };
  }, [doc, connectionState]);

  /** Creates a sticky note centred on a screen point, selects it, starts editing. */
  const createStickyAtScreen = useCallback(
    (p: Point) => {
      const world = screenToWorld(cameraRef.current, p);
      undoController.boundary();
      const id = createSticky(doc, world);
      if (id) {
        selection.startEdit(id);
      }
    },
    [doc, selection, undoController],
  );

  /** Creates a sticky note at the centre of the visible board area. */
  const createStickyAtCentre = useCallback(() => {
    createStickyAtScreen({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }, [createStickyAtScreen]);

  /** Delete button on the selection bar (sel.group_delete). */
  const handleDeleteSelection = useCallback(() => {
    if (selection.ids.size === 0) return;
    undoController.boundary();
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection, undoController]);

  /** Editor finished: 'selected' keeps the selection (Escape), 'unselected' clears it. */
  const handleEndEdit = useCallback(
    (next: 'selected' | 'unselected') => {
      selection.endEdit();
      if (next === 'unselected') selection.clear();
    },
    [selection],
  );

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        onCamera={handleCamera}
        onEmptyDoubleClick={createStickyAtScreen}
        onEmptyClick={() => selection.clear()}
        marquee={{ begin: marquee.begin, move: marquee.move, end: marquee.end, cancel: marquee.cancel }}
      >
        <MarqueeRect rect={marquee.rect} camera={camera} />
        {objects.map((obj) => {
          const spec = getObjectType(obj.type);
          if (!spec) return null; // unknown types are not rendered (stories 9–12)
          const Component = spec.Component;
          return (
            <Component
              key={obj.id}
              obj={obj}
              doc={doc}
              zoom={camera.zoom}
              selected={selection.ids.has(obj.id)}
              editing={selection.editingId === obj.id}
              dragging={gesture.draggingId === obj.id}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onStartEdit={selection.startEdit}
              onEndEdit={handleEndEdit}
              undo={undoController}
            />
          );
        })}
      </BoardViewport>
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={objects}
        doc={doc}
        camera={camera}
        onDelete={handleDeleteSelection}
        onBoundary={() => undoController.boundary()}
      />
      <Toolbar onCreateSticky={createStickyAtCentre} undoButtons={<UndoButtons {...undo} />} />
      <SharePanel boardId={boardId} />
    </>
  );
}

/**
 * Board page (share.open_link / share.not_found / share.unreachable).
 *
 * - Malformed id → Board not found, no request sent.
 * - Valid id → "Opening board…" while `checkBoard` runs; `exists` → the board
 *   (stories 1–4 UI + Share panel); `not_found` → Board not found;
 *   `unreachable` → "Couldn't reach vidi6. Retrying…" with exponential
 *   backoff (BOARD_CHECK_RETRY_BASE_MS, capped at RECONNECT_MAX_BACKOFF_MS),
 *   reaching ready or not found without a reload.
 */
export function BoardPage({ id }: { id: string }): JSX.Element {
  if (!isValidBoardId(id)) {
    return <NotFoundPage />;
  }
  return <BoardCheck id={id} />;
}

function BoardCheck({ id }: { id: string }): JSX.Element {
  const [state, setState] = useState<BoardPageState>({ kind: 'checking' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const runCheck = (attempt: number) => {
      checkBoard(id).then((result) => {
        if (cancelled) return;
        const next = nextBoardPageState({ kind: 'checking' }, result, attempt);
        if (next.kind === 'ready') {
          setState({ kind: 'ready', boardId: id });
        } else {
          setState(next);
          if (next.kind === 'unreachable') {
            timerRef.current = setTimeout(() => runCheck(attempt + 1), next.nextRetryMs);
          }
        }
      });
    };

    runCheck(1);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [id]);

  switch (state.kind) {
    case 'checking':
      return (
        <div data-testid="board-checking" style={pageStyle}>
          <p>Opening board…</p>
        </div>
      );
    case 'ready':
      return <Board boardId={id} />;
    case 'not_found':
      return <NotFoundPage />;
    case 'unreachable':
      return (
        <div data-testid="board-unreachable" style={pageStyle}>
          <p>Couldn't reach vidi6. Retrying…</p>
        </div>
      );
  }
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'system-ui, sans-serif',
  background: '#FAFAFA',
  color: '#555',
};
