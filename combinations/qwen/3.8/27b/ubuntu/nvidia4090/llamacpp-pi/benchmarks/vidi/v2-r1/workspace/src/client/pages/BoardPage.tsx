// Board page (story 5, share.pages): checks that the board in the URL
// exists before mounting the stories 1–4 board, with the loading, not-found
// and unreachable states around it. The stories 1–4 board UI (formerly the
// body of App.tsx) mounts only in the `ready` state.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
} from 'react';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Point,
  type Size,
} from '../canvas/camera';
import { useCamera } from '../canvas/useCamera';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useBoardKeys } from '../board/useBoardKeys';
import { useTransformGesture } from '../board/useTransformGesture';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { SelectionBar } from '../board/SelectionBar';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { Toolbar } from '../board/Toolbar';
import { getObjectType } from '../objects/registry';
import { NoteToolbar } from '../objects/NoteToolbar';
import {
  createSticky,
  deleteObject,
  deleteObjects,
  getStickyText,
  objectBounds,
  objectsSnapshot,
  setStickyColor,
  snapshot,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';
import { isValidBoardId } from '../../shared/board-id';
import { isTestMode, type Vidi6TestHooks } from '../testHooks';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../App';
import { checkBoard } from '../api';
import { SharePanel } from '../share/SharePanel';
import { nextBoardPageState, type BoardPageState } from './state';
import { NotFoundPage } from './NotFoundPage';

/** Gap (screen px) between the note top edge and the note toolbar. */
const NOTE_TOOLBAR_GAP_PX = 8;

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function BoardPage(props: { id: string }): JSX.Element {
  const { id } = props;
  // Malformed codes go straight to not found without any request
  // (share.not_found). Everything else starts with a check.
  const [state, setState] = useState<BoardPageState>(() =>
    isValidBoardId(id) ? { kind: 'checking' } : { kind: 'not_found' },
  );
  const attemptRef = useRef(0);

  // Initial check on mount (and when the id changes).
  useEffect(() => {
    if (!isValidBoardId(id)) {
      setState({ kind: 'not_found' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'checking' });
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    void checkBoard(id).then((result) => {
      if (cancelled) return;
      setState((prev) => {
        if (result.kind === 'exists') return { kind: 'ready', boardId: id };
        return nextBoardPageState(prev, result, attempt);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Retry while unreachable, with backoff. The timer is cleared on unmount
  // and as soon as the state settles (ready / not_found), and the board then
  // opens — or Board not found is shown — without a reload (share.unreachable).
  useEffect(() => {
    if (state.kind !== 'unreachable') return;
    const timer = setTimeout(() => {
      attemptRef.current += 1;
      const attempt = attemptRef.current;
      void checkBoard(id).then((result) => {
        setState((prev) => {
          if (result.kind === 'exists') return { kind: 'ready', boardId: id };
          return nextBoardPageState(prev, result, attempt);
        });
      });
    }, state.nextRetryMs);
    return () => clearTimeout(timer);
  }, [state, id]);

  switch (state.kind) {
    case 'checking':
      return (
        <div className="board-opening" role="status" data-testid="board-opening">
          Opening board…
        </div>
      );
    case 'unreachable':
      return (
        <div className="board-unreachable" role="status" data-testid="board-unreachable">
          Couldn't reach vidi6. Retrying…
        </div>
      );
    case 'not_found':
      return <NotFoundPage />;
    case 'ready':
      return <Board boardId={id} />;
  }
}

/** The stories 1–7 board, mounted only once the board is known to exist. */
function Board(props: { boardId: string }): JSX.Element {
  const boardId = props.boardId;
  const { doc, objects, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(objects);
  const editable = canEdit(connectionState);
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  // Viewport size from the root element; camera x,y are unchanged on resize.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setSize((s) =>
          s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height },
        );
      }
    };
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, []);

  const cam = useCamera(size);

  // Story 7: the generic transform gesture (group move + bounding-box resize)
  // and the selection keyboard commands.
  const gesture = useTransformGesture({
    doc,
    camera: cam.camera,
    selection,
    snapshot: objects,
    canEdit: editable,
  });
  useBoardKeys({ doc, selection, snapshot: objects, canEdit: editable });

  // Shift+drag marquee: on release, the fully-inside ids join the selection.
  const marquee = useMarquee(cam.camera, objects, (ids) => selection.setMany(ids, true));

  const createStickyAt = useCallback(
    (screen: Point) => {
      if (!editable) return; // story 4: edit lock
      const world = screenToWorld(cam.camera, screen);
      const id = createSticky(doc, world);
      if (id) {
        // The new note is selected and starts editing immediately (the
        // 'edit' action accepts ids that are not in the snapshot yet), so
        // typed characters go straight into it.
        selection.startEdit(id);
      }
    },
    [cam.camera, doc, editable, selection],
  );

  const deleteSelection = useCallback(() => {
    if (!editable || selection.ids.size === 0) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection, editable]);

  // Test hooks (test mode only).
  useEffect(() => {
    if (!isTestMode()) return;
    const hooks: Vidi6TestHooks = {
      doc,
      getCamera: () => cam.camera,
      setCamera: (c) => cam.setCamera(c),
      getNotes: () =>
        snapshot(doc).map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          color: n.color,
          text: n.text,
          z: n.z,
        })),
      getObjects: () =>
        objectsSnapshot(doc).map((o) => {
          const b = objectBounds(o);
          return {
            id: o.id,
            type: o.type,
            x: o.x,
            y: o.y,
            width: b.width,
            height: b.height,
            color: o.color,
            text: o.text,
            z: o.z,
          };
        }),
      getConnectionState: () => connectionState,
      createNote: () => {
        createStickyAt({ x: size.width / 2, y: size.height / 2 });
      },
      createNoteAt: (x, y, color, text) => {
        const stickyColor: StickyColor | undefined =
          Object.keys(STICKY_COLORS).includes(color) ? (color as StickyColor) : undefined;
        const id = createSticky(doc, { x, y }, stickyColor);
        if (id !== null && text !== undefined && text !== '') {
          getStickyText(doc, id)?.insert(0, text);
        }
        return id;
      },
    };
    window.__vidi6 = hooks;
    return () => {
      delete window.__vidi6;
    };
  }, [doc, cam.camera, cam.setCamera, connectionState, size, createStickyAt]);

  // Objects of a known type render through their registry component, in a
  // stable DOM order (by id); visual stacking comes from each object's CSS
  // z-index. Reordering the DOM when z changes would move the element of an
  // in-flight drag and break its pointer capture, so DOM order never follows z.
  const objectsById = [...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // With exactly one sticky selected, the story 2 NoteToolbar (colours +
  // delete) replaces the multi-selection bar (sel.bar).
  const selectedObjects = objects.filter((o) => selection.ids.has(o.id));
  const singleSticky: ObjectSnapshot | null =
    selectedObjects.length === 1 && selectedObjects[0].type === 'sticky'
      ? selectedObjects[0]
      : null;
  const noteToolbarVisible =
    singleSticky !== null && selection.editingId !== singleSticky.id;
  const singleStickyColor: StickyColor =
    typeof singleSticky?.color === 'string' && singleSticky.color in STICKY_COLORS
      ? (singleSticky.color as StickyColor)
      : ('yellow' as StickyColor);

  return (
    <div ref={rootRef} className="board-root" data-testid="board-root">
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cam.camera}
        size={size}
        onBeginPan={cam.beginPan}
        onPanMove={cam.panMove}
        onEndPan={cam.endPan}
        onWheel={cam.wheel}
        onZoomStep={cam.zoomStep}
        onReset={cam.reset}
        onCreateStickyAt={createStickyAt}
        onEmptyClick={() => selection.clear()}
        marquee={marquee}
      >
        {objectsById.map((obj) => {
          const spec = getObjectType(obj.type);
          if (!spec) return null; // unknown type: in the doc, not on screen
          const Component = spec.Component;
          return (
            <Component
              key={obj.id}
              obj={obj}
              doc={doc}
              zoom={cam.camera.zoom}
              selected={selection.ids.has(obj.id)}
              editing={selection.editingId === obj.id}
              canEdit={editable}
              onPointerDown={gesture.onObjectPointerDown}
              onStartEdit={(id: string) => {
                if (editable) selection.startEdit(id); // story 4: edit lock
              }}
              onEndEdit={(next) => {
                // 'selected' keeps the selection (Escape); 'unselected' clears
                // it (click outside — the editor's outside-pointerdown).
                if (next === 'unselected') selection.clear();
                else selection.endEdit();
              }}
            />
          );
        })}
      </BoardViewport>

      <MarqueeRect rect={marquee.rect} camera={cam.camera} />
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={cam.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <SelectionBar ids={selection.ids} snapshot={objects} onDelete={deleteSelection} />

      <Toolbar
        disabled={!editable}
        onCreateSticky={() => createStickyAt({ x: size.width / 2, y: size.height / 2 })}
      />

      {noteToolbarVisible && singleSticky && (
        <div
          className="note-toolbar-anchor"
          style={{
            left: worldToScreen(cam.camera, {
              x: singleSticky.x + objectBounds(singleSticky).width / 2,
              y: singleSticky.y,
            }).x,
            top:
              worldToScreen(cam.camera, { x: singleSticky.x, y: singleSticky.y }).y -
              NOTE_TOOLBAR_GAP_PX,
          }}
        >
          <NoteToolbar
            color={singleStickyColor}
            onColor={(c) => {
              if (!editable) return; // story 4: edit lock
              setStickyColor(doc, singleSticky.id, c);
            }}
            onDelete={() => {
              if (!editable) return; // story 4: edit lock
              if (deleteObject(doc, singleSticky.id)) selection.clear();
            }}
          />
        </div>
      )}

      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />

      <NavigationHint visible={!cam.hasNavigated} />

      {/* Story 5: the Share button and panel sit in the top-right corner. */}
      <SharePanel boardId={boardId} />
    </div>
  );
}
