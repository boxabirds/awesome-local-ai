import type { ReactElement } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
} from '../shared/board-model';
import type { Point, Size } from './canvas/camera';
import { screenToWorld } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { ZoomControls } from './canvas/ZoomControls';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useUndo } from './board/useUndo';
import { useSelection } from './board/useSelection';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { getObjectType } from './objects/registry';
import { SharePanel } from './share/SharePanel';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { STICKY_SIZE_WORLD } from '../shared/config';

/**
 * Editing gate (persist.client_status): the board is only non-editable while
 * it failed to load from storage. While reconnecting (storage failure, network
 * drop) the board is still readable and editing stays enabled — unsaved
 * changes are re-sent on reconnection.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

declare global {
  interface Window {
    __vidi6?: {
      setCamera(x: number, y: number, zoom: number): void;
      connectionState: string;
      /** Test-only: the board's Y.Doc, for seeding/inspection. */
      doc?: Y.Doc;
      /** Test-only: the Yjs module, so tests can build/apply remote updates. */
      Y?: typeof import('yjs');
    };
  }
}

/**
 * The board (stories 1-7), keyed by board id. Story 7: objects render through
 * the type registry; selection, marquee, the transform gesture, the selection
 * overlay/bar and the keyboard commands are all generic.
 */
export function Board(props: { boardId: string }): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 1280, height: 800 });

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () =>
      setSize({ width: el.clientWidth || window.innerWidth, height: el.clientHeight || window.innerHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cam = useCamera(size);
  const { doc, objects, connectionState } = useBoardDoc(props.boardId);
  const selection = useSelection(objects);
  const editable = canEdit(connectionState);

  // Story 8 (undo.session_only): one undo controller per board document.
  const undoState = useUndo(doc);

  // Marquee: Shift+drag on empty space adds fully-contained ids to the set.
  const marquee = useMarquee(cam.camera, objects, (ids) => selection.setMany(ids, true));

  // Generic transform gesture: group move + bounding-box resize. Story 8:
  // the gesture is one undo step (boundary at start and end).
  const transform = useTransformGesture({
    doc,
    camera: cam.camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: undoState.boundary,
    onGestureEnd: undoState.boundary,
  });

  // Selection keyboard commands (select all, clear, nudge, delete, edit, undo/redo).
  useBoardKeys({ doc, selection, snapshot: objects, canEdit: editable, undo: undoState.controller });

  // Test-only hooks (excluded from production builds).
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    window.__vidi6 = {
      setCamera: (x, y, zoom) => cam.setCameraDirect({ x, y, zoom }),
      connectionState,
      doc,
      Y,
    };
  }, [cam, connectionState, doc]);

  // The id of a note just created, pending select + edit. A brand-new note is
  // not in the snapshot (hence not in the selection's present set) at the moment
  // it is written, so selecting it synchronously would be rejected; we apply it
  // once the note shows up in the snapshot instead.
  const createdIdRef = useRef<string | null>(null);

  const createStickyAt = useCallback(
    (world: Point) => {
      if (!editable) return; // load_failed: the board is not editable
      // Story 8: a single model call is one undo step.
      undoState.boundary();
      const id = createSticky(doc, {
        x: world.x - STICKY_SIZE_WORLD / 2,
        y: world.y - STICKY_SIZE_WORLD / 2,
      });
      undoState.boundary();
      if (id) createdIdRef.current = id;
    },
    [doc, editable, undoState.boundary],
  );

  // Select + edit the just-created note once it is present. Runs after
  // useSelection's prune (registered earlier), so the present set is current;
  // the select is retried across renders until it lands.
  useEffect(() => {
    const id = createdIdRef.current;
    if (!id) return;
    if (selection.ids.has(id)) {
      createdIdRef.current = null; // select took effect
      return;
    }
    if (!objects.some((o) => o.id === id)) return;
    selection.click(id);
    selection.startEdit(id);
  }, [objects, selection]);

  const createStickyCenter = useCallback(() => {
    createStickyAt(screenToWorld(cam.camera, { x: size.width / 2, y: size.height / 2 }));
  }, [createStickyAt, cam.camera, size]);

  const deleteSelection = useCallback(() => {
    if (!editable) return; // load_failed: deletion is a no-op
    if (selection.ids.size === 0) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection, editable]);

  // Camera zoom shortcuts (kept from story 1); selection keys live in
  // useBoardKeys.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        cam.zoomStep('in');
        return;
      }
      if (mod && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        cam.zoomStep('out');
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        cam.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cam]);

  // A pointerdown outside the note being edited ends editing (selection kept).
  const editingId = selection.editingId;
  const endEdit = selection.endEdit;
  useEffect(() => {
    if (editingId === null) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = document.querySelector(`[data-note-id="${CSS.escape(editingId)}"]`);
      if (el && el.contains(e.target as Node)) return;
      endEdit();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [editingId, endEdit]);

  return (
    <div
      ref={rootRef}
      className="app"
      style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#f3f5f8' }}
    >
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cam.camera}
        size={size}
        onBeginPan={cam.beginPan}
        onPanMove={cam.panMove}
        onEndPan={cam.endPan}
        onWheel={cam.wheel}
        onDblClickEmpty={(world: Point) => createStickyAt(world)}
        onEmptyClick={() => selection.clear()}
        onMarqueeStart={(screen) => marquee.begin(screen)}
        onMarqueeMove={(screen) => marquee.move(screen)}
        onMarqueeEnd={() => marquee.end()}
        onMarqueeCancel={() => marquee.cancel()}
      >
        {objects.map((o) => {
          const spec = getObjectType(o.type);
          if (!spec) return null; // unknown type: skip
          const C = spec.Component;
          return (
            <C
              key={o.id}
              obj={o}
              doc={doc}
              zoom={cam.camera.zoom}
              selected={selection.ids.has(o.id)}
              editing={selection.editingId === o.id}
              editable={editable}
              undo={undoState.controller}
              onObjectPointerDown={transform.onObjectPointerDown}
              onStartEdit={(id: string) => {
                if (editable) selection.startEdit(id);
              }}
              onEndEdit={() => selection.endEdit()}
            />
          );
        })}
        <SelectionOverlay
          ids={selection.ids}
          snapshot={objects}
          camera={cam.camera}
          onHandlePointerDown={transform.onHandlePointerDown}
        />
        <SelectionBar ids={selection.ids} snapshot={objects} onDelete={deleteSelection} />
        <MarqueeRect rect={marquee.rect} zoom={cam.camera.zoom} />
      </BoardViewport>
      <Toolbar
        onCreateSticky={createStickyCenter}
        disabled={!editable}
        canUndo={undoState.canUndo}
        canRedo={undoState.canRedo}
        onUndo={undoState.undo}
        onRedo={undoState.redo}
      />
      <ZoomControls
        zoom={cam.camera.zoom}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
      <SharePanel boardId={props.boardId} />
    </div>
  );
}
