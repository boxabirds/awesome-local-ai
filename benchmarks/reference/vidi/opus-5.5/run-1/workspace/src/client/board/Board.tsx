import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  createSticky,
  deleteObjects,
  objectSnapshot,
  setStickyColor,
  snapshot,
  type ObjectSnapshot,
} from '../../shared/board-model';
import type { FillColor, StickyColor, StrokeColor, TextSize } from '../../shared/config';
import { setShapeStyle } from '../../shared/objects/shape';
import { createText, setTextSize } from '../../shared/objects/text';
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
import { BoardObjectsContext } from '../objects/boardObjects';
import { getObjectType, topObjectAt } from '../objects/registry';
import { ConnectorTool } from '../tools/ConnectorTool';
import { PenTool } from '../tools/PenTool';
import { PenToolbar } from '../tools/PenToolbar';
import { ShapeTool } from '../tools/ShapeTool';
import { usePenOptions } from '../tools/usePenOptions';
import { useActiveTool } from '../tools/useActiveTool';
import { textMeasurer } from '../objects/textLayout';
import { remeasureText } from '../objects/useTextBoxSync';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState, ProviderFactory } from '../sync/connectBoard';
import { IMAGE_PICKER_ACCEPT, useImageInsert } from '../images/useImageInsert';
import { ImageBoardContext, useImageClock, type ImageBoardState } from '../objects/ImageObject';
import { Toast } from '../ui/Toast';
import { isImage } from '../../shared/objects/image';

/**
 * Whether the board may be edited. False only while its saved state cannot be loaded: an
 * empty stand-in must not be edited as if it were the board (PRD persist.load_failure).
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

const UNMEASURED: Size = { width: 0, height: 0 };
/**
 * Recorded as `createdBy` on new text objects. Identity (story 6) is not part of this build, so
 * each tab gets an anonymous guest id.
 */
function newGuestId(): string {
  return `g_${crypto.randomUUID()}`;
}
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
  /** Builds the connection to the board's room; component tests pass a fake (story 12). */
  createProvider?: ProviderFactory;
}

/** Accessible name of the Image tool's (hidden) file input. */
export const IMAGE_PICKER_LABEL = 'Choose images';

export function Board({ boardId, children, createUndoController, createProvider }: BoardProps) {
  const [viewport, setViewport] = useState<Size>(UNMEASURED);
  const controller = useCamera(viewport);
  const { camera } = controller;
  const { doc, objects, connection } = useBoardDoc(boardId, createProvider);
  const selection = useSelection(objects);
  const { ids: selectedIds, editingId, click: selectOnly, startEdit: beginEdit, endEdit, clear } = selection;
  const editable = canEdit(connection);
  // Story 8: this tab's own history for this board document (session only).
  const history = useUndoController(doc, createUndoController);
  const undoControls = useUndo(history, editable);
  // Story 9/10: this viewer's active tool; creating a shape or arrow selects it and returns to Select.
  const { tool, setTool, shapeKind, setShapeKind, toolCreated } = useActiveTool({
    canEdit: editable,
    onSelect: selection.adopt,
  });
  const [authorId] = useState(newGuestId);
  // Story 11: pen colour and thickness, kept until the page is reloaded.
  const pen = usePenOptions();

  const stateRef = useRef({ selection, camera, viewport, editable, history, authorId });
  stateRef.current = { selection, camera, viewport, editable, history, authorId };

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

  // Text tool click (text.create): new size M text with its top-left at the point, being edited;
  // the tool goes back to Select.
  const onToolClick = useCallback(
    (point: Point) => {
      const { camera: cam, editable: canWrite, authorId: author } = stateRef.current;
      setTool('select');
      if (!canWrite) return;
      const id = asStep(() => createText(doc, screenToWorld(cam, point), author));
      if (id) startEdit(id);
    },
    [doc, startEdit, asStep, setTool],
  );

  const onTextSize = useCallback(
    (id: string, size: TextSize) => {
      if (!stateRef.current.editable) return;
      // Size and the re-measured box are one step; the top-left stays put (text.size).
      asStep(() => {
        if (setTextSize(doc, id, size)) remeasureText(doc, id, textMeasurer());
      });
    },
    [doc, asStep],
  );

  // Story 12: images by drop, paste and the Image tool's picker.
  const images = useImageInsert({
    doc,
    boardId,
    camera,
    connection,
    identityId: authorId,
    viewport,
    canEdit: editable,
    isEditingText: () => stateRef.current.selection.editingId !== null,
    step: asStep,
  });
  const { onPaste } = images;
  useEffect(() => {
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onPaste]);
  const openImagePicker = useCallback(() => {
    setTool('select');
    images.openPicker();
  }, [images, setTool]);
  const anyUploading = objects.some((o) => isImage(o) && o.status === 'uploading');
  const imageNow = useImageClock(anyUploading);
  const removeImage = useCallback(
    (id: string) => {
      if (stateRef.current.editable) asStep(() => deleteObjects(doc, [id]));
    },
    [doc, asStep],
  );
  const imageBoard = useMemo<ImageBoardState>(
    () => ({
      identityId: authorId,
      progress: images.progress,
      now: imageNow,
      canRetry: images.canRetry,
      retry: (id) => void images.retry(id),
      remove: removeImage,
    }),
    [authorId, images.progress, imageNow, images.canRetry, images.retry, removeImage],
  );

  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    onStartEdit: startEdit,
    undo: undoControls,
    boundary: history.boundary,
    tool,
    setTool,
    onCreateSticky,
    onOpenImagePicker: openImagePicker,
  });

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

  const onShapeStyle = useCallback(
    (id: string, style: { fill?: FillColor; stroke?: StrokeColor }) => {
      if (stateRef.current.editable) asStep(() => setShapeStyle(doc, id, style));
    },
    [doc, asStep],
  );

  // Arrows and pen strokes take no pointer events of their own: a press near an arrow's or a
  // stroke's line (its type's hitTest) selects (and drags) it, unless an object stacked above
  // it was pressed (connector.select, pen.select).
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const getObjects = useCallback(() => objectsRef.current, []);
  const onPressCapture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, point: Point): boolean => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('[data-connector-handle]')) return false;
      const { camera: cam, selection: sel } = stateRef.current;
      const list = objectsRef.current;
      const pressedId = target?.closest<HTMLElement>('[data-id]')?.dataset.id;
      if (pressedId !== undefined && pressedId === sel.editingId) return false;
      const pressedIndex = pressedId === undefined ? -1 : list.findIndex((o) => o.id === pressedId);
      const above = pressedIndex < 0 ? list : list.slice(pressedIndex + 1);
      const arrow = topObjectAt(above, screenToWorld(cam, point), cam.zoom, (_o, spec) => spec.hitByGeometry === true);
      if (!arrow) return false;
      if (sel.editingId !== null) endEdit('selected');
      gesture.onObjectPointerDown(e, arrow.id);
      return true;
    },
    [gesture, endEdit],
  );

  let toolLayer: ReactNode = null;
  if (editable && tool === 'shape') {
    toolLayer = (
      <ShapeTool
        kind={shapeKind}
        camera={camera}
        doc={doc}
        createdBy={authorId}
        onCreated={toolCreated}
        step={asStep}
      />
    );
  } else if (editable && tool === 'pen') {
    toolLayer = (
      <PenTool
        camera={camera}
        color={pen.color}
        thickness={pen.thickness}
        doc={doc}
        identityId={authorId}
        step={asStep}
      />
    );
  } else if (editable && tool === 'connector') {
    toolLayer = (
      <ConnectorTool
        camera={camera}
        snapshot={objects}
        doc={doc}
        createdBy={authorId}
        onCreated={toolCreated}
        step={asStep}
      />
    );
  }

  const stackIndex = useMemo(() => new Map(objects.map((o, i) => [o.id, i + 1])), [objects]);
  const domOrder = useMemo(() => [...objects].sort(byCreation), [objects]);
  const gestureActive = gesture.activeIds.size > 0;

  return (
    <UndoContext.Provider value={history}>
      <BoardObjectsContext.Provider value={getObjects}>
        <ImageBoardContext.Provider value={imageBoard}>
        <main className="app">
          <BoardViewport
            controller={controller}
            onResize={setViewport}
            onEmptyPointerDown={onEmptyPointerDown}
            onEmptyClick={clear}
            onEmptyDoubleClick={onEmptyDoubleClick}
            marquee={marquee}
            tool={tool}
            onToolClick={onToolClick}
            overlay={toolLayer}
            onPressCapture={onPressCapture}
            onDragOver={images.onDragOver}
            onDragLeave={images.onDragLeave}
            onDrop={images.onDrop}
            dropHighlight={images.dragActive}
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
          <Toolbar
            onCreateSticky={onCreateSticky}
            disabled={!editable}
            undo={undoControls}
            tool={tool}
            onTool={setTool}
            shapeKind={shapeKind}
            onShapeKind={setShapeKind}
            onImage={openImagePicker}
          />
          {editable && tool === 'pen' && (
            <PenToolbar
              color={pen.color}
              thickness={pen.thickness}
              onColor={pen.setColor}
              onThickness={pen.setThickness}
            />
          )}
          <SelectionBar
            ids={selectedIds}
            snapshot={objects}
            camera={camera}
            onDelete={deleteSelected}
            onColor={onColor}
            onTextSize={onTextSize}
            onShapeStyle={onShapeStyle}
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
          <input
            ref={images.pickerRef}
            type="file"
            multiple
            accept={IMAGE_PICKER_ACCEPT}
            className="image-picker"
            data-testid="image-picker"
            aria-label={IMAGE_PICKER_LABEL}
            tabIndex={-1}
            onChange={images.onPickerChange}
          />
          <Toast messages={images.toast.messages} toastKey={images.toast.key} onDismiss={images.dismissToast} />
          {children}
        </main>
        </ImageBoardContext.Provider>
      </BoardObjectsContext.Provider>
    </UndoContext.Provider>
  );
}
