import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  createSticky,
  deleteObjects,
  objectSnapshot,
  setStickyColor,
  snapshot,
  type ObjectSnapshot,
} from '../../shared/board-model';
import type { StickyColor } from '../../shared/config';
import { MarqueeRect, useMarquee } from './Marquee';
import { SelectionBar } from './SelectionBar';
import { SelectionOverlay } from './SelectionOverlay';
import { Toolbar } from './Toolbar';
import { useBoardDoc } from './useBoardDoc';
import { useBoardKeys } from './useBoardKeys';
import { useSelection, type EndEditNext } from './useSelection';
import { useTransformGesture } from './useTransformGesture';
import { UndoContext, useUndo, useUndoController, type UndoFactory } from './useUndo';
import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point, type Size } from '../canvas/camera';
import { installTestHooks } from '../canvas/testHooks';
import { useCamera } from '../canvas/useCamera';
import { getObjectType } from '../objects/registry';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';

/**
 * Whether the board may be edited. False only while its saved state cannot be loaded: an
 * empty stand-in must not be edited as if it were the board (PRD persist.load_failure).
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

const UNMEASURED: Size = { width: 0, height: 0 };
const HALF = 2;

/** Creation order: a stable DOM order, so stacking changes never move an object's element. */
function byCreation(a: ObjectSnapshot, b: ObjectSnapshot): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The board of stories 1–4 and 7 (camera, objects, live sync, persistence, multi-select) for
 * one existing board. Since story 5 it is mounted by BoardPage only after the board's link was
 * checked. Objects render through the type registry; unknown types are skipped.
 */
export interface BoardProps {
  boardId: string;
  children?: ReactNode;
  /** Builds this tab's undo controller (story 8); component tests pass a fake. */
  createUndoController?: UndoFactory;
}

export function Board({ boardId, children, createUndoController }: BoardProps) {
  const [viewport, setViewport] = useState<Size>(UNMEASURED);
  const controller = useCamera(viewport);
  const { camera } = controller;
  const { doc, objects, connection } = useBoardDoc(boardId);
  const selection = useSelection(objects);
  const { ids: selectedIds, editingId, click: selectOnly, startEdit: beginEdit, endEdit, clear } = selection;
  const editable = canEdit(connection);
  // Story 8: this tab's own history for this board document (session only).
  const history = useUndoController(doc, createUndoController);
  const undoControls = useUndo(history, editable);

  const stateRef = useRef({ selection, camera, viewport, editable, history });
  stateRef.current = { selection, camera, viewport, editable, history };

  /** Runs one user action as exactly one undo step (undo.steps). */
  const asStep = useCallback(<T,>(action: () => T): T => {
    const { history: h } = stateRef.current;
    h.boundary();
    try {
      return action();
    } finally {
      h.boundary();
    }
  }, []);

  // A whole move or resize gesture is one undo step, including a cancelled one.
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: history.beginGesture,
    onGestureEnd: history.endGesture,
  });
  const marquee = useMarquee(camera, objects, (ids) => stateRef.current.selection.setMany(ids, true));

  // Every edit entry point goes through these guards: no board-model mutation while !editable.
  const startEdit = useCallback(
    (id: string) => {
      if (stateRef.current.editable) beginEdit(id);
    },
    [beginEdit],
  );

  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    onStartEdit: startEdit,
    undo: undoControls,
    boundary: history.boundary,
  });

  // Losing the board mid-edit ends the edit (text typed so far is already in the document).
  useEffect(() => {
    if (!editable && stateRef.current.selection.editingId !== null) endEdit('selected');
  }, [editable, endEdit]);

  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return undefined;
    return installTestHooks({
      getNotes: () => snapshot(doc),
      getObjects: () => objectSnapshot(doc),
      getDoc: () => doc,
      getSelection: () => [...stateRef.current.selection.ids],
    });
  }, [doc]);

  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return undefined;
    return installTestHooks({ connectionState: connection });
  }, [connection]);

  const createAt = useCallback(
    (world: Point) => {
      if (!stateRef.current.editable) return;
      const id = asStep(() => createSticky(doc, world));
      if (id) startEdit(id);
    },
    [doc, startEdit, asStep],
  );

  const onEmptyDoubleClick = useCallback(
    (point: Point) => createAt(screenToWorld(stateRef.current.camera, point)),
    [createAt],
  );

  const onCreateSticky = useCallback(() => {
    const { camera: cam, viewport: size } = stateRef.current;
    createAt(screenToWorld(cam, { x: size.width / HALF, y: size.height / HALF }));
  }, [createAt]);

  const onEmptyPointerDown = useCallback(() => {
    if (stateRef.current.selection.editingId !== null) endEdit('unselected');
  }, [endEdit]);

  const deleteSelected = useCallback(() => {
    const { selection: sel, editable: canWrite } = stateRef.current;
    if (sel.ids.size === 0 || !canWrite) return;
    asStep(() => deleteObjects(doc, [...sel.ids]));
    sel.clear();
  }, [doc, asStep]);

  const onColor = useCallback(
    (id: string, c: StickyColor) => {
      if (stateRef.current.editable) asStep(() => setStickyColor(doc, id, c));
    },
    [doc, asStep],
  );

  const onEndEdit = useCallback((next: EndEditNext) => endEdit(next), [endEdit]);

  const stackIndex = useMemo(() => new Map(objects.map((o, i) => [o.id, i + 1])), [objects]);
  const domOrder = useMemo(() => [...objects].sort(byCreation), [objects]);
  const gestureActive = gesture.activeIds.size > 0;

  return (
    <UndoContext.Provider value={history}>
      <main className="app">
        <BoardViewport
          controller={controller}
          onResize={setViewport}
          onEmptyPointerDown={onEmptyPointerDown}
          onEmptyClick={clear}
          onEmptyDoubleClick={onEmptyDoubleClick}
          marquee={marquee}
        >
          {domOrder.map((obj) => {
            const spec = getObjectType(obj.type);
            if (!spec) return null;
            const { Component } = spec;
            return (
              <Component
                key={obj.id}
                object={obj}
                doc={doc}
                zoom={camera.zoom}
                stackIndex={stackIndex.get(obj.id) ?? 0}
                selected={selectedIds.has(obj.id)}
                editing={obj.id === editingId}
                dragging={gesture.activeIds.has(obj.id)}
                readOnly={!editable}
                onPointerDown={gesture.onObjectPointerDown}
                onSelect={selectOnly}
                onStartEdit={startEdit}
                onEndEdit={onEndEdit}
              />
            );
          })}
          <MarqueeRect rect={marquee.rect} camera={camera} zIndex={objects.length + 1} />
        </BoardViewport>
        {editingId === null && (
          <SelectionOverlay
            ids={selectedIds}
            snapshot={objects}
            camera={camera}
            onHandlePointerDown={gesture.onHandlePointerDown}
            hideHandles={!editable}
          />
        )}
        <Toolbar onCreateSticky={onCreateSticky} disabled={!editable} undo={undoControls} />
        <SelectionBar
          ids={selectedIds}
          snapshot={objects}
          camera={camera}
          onDelete={deleteSelected}
          onColor={onColor}
          readOnly={!editable}
          hidden={editingId !== null || gestureActive}
        />
        <NavigationHint visible={!controller.hasNavigated} />
        <ConnectionStatus state={connection} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => controller.zoomStep('in')}
          onZoomOut={() => controller.zoomStep('out')}
          onReset={controller.reset}
        />
        {children}
      </main>
    </UndoContext.Provider>
  );
}
