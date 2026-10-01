// src/client/pages/BoardContent.tsx
// The board UI from stories 1-9.

import { useEffect, useState, useCallback, useMemo } from 'react';
import type { ReactElement } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { useCamera } from '../canvas/useCamera';
import { screenToWorld } from '../canvas/camera';
import type { Size, Camera, Point } from '../canvas/camera';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { useTransformGesture } from '../board/useTransformGesture';
import { useBoardKeys } from '../board/useBoardKeys';
import { useTool } from '../board/useTool';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { Toolbar } from '../board/Toolbar';
import { createUndo } from '../board/undo';
import { useUndo } from '../board/useUndo';
import { StickyNote } from '../objects/StickyNote';
import '../objects/registerSticky';
import { TextObject } from '../objects/TextObject';
import '../objects/registerText';
import { createSticky, deleteObjects, objectBounds } from '../../shared/board-model';
import { createText, deleteIfEmpty, setTextBox } from '../../shared/objects/text';
import { TEXT_SIZES, TEXT_LINE_HEIGHT, TEXT_MAX_AUTO_WIDTH_WORLD } from '../../shared/config';
import { unionRects } from '../../shared/geometry';
import { worldToScreen } from '../canvas/camera';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../sync/connectBoard';

// Test-only hook
declare global {
  interface Window {
    __vidi6?: {
      setCamera: (cam: Camera) => void;
      connectionState?: string;
      undo?: import('../board/undo').UndoController;
    };
  }
}

export function BoardContent(props: { boardId: string }): ReactElement {
  const { boardId } = props;

  const [viewport, setViewport] = useState<Size>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  const cam = useCamera(viewport);
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(notes);
  const editable = canEdit(connectionState);

  // Per-board undo controller (story 8): one per board doc, destroyed on
  // board change/unmount. History is session-only (never persisted).
  const undo = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => undo.destroy(), [undo]);
  const undoState = useUndo(undo, editable);

  // Tool state (story 9)
  const { tool, setTool } = useTool(editable);

  // Track viewport size
  useEffect(() => {
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Expose test hook in test mode
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      window.__vidi6 = {
        setCamera: (c: Camera) => {
          cam.setCamera(c);
        },
        connectionState,
        undo,
      };
    }
    return () => {
      delete window.__vidi6;
    };
  }, [undo, connectionState]);

  // Marquee selection
  const marquee = useMarquee(cam.camera, notes, (ids) => {
    selection.setMany(ids, true);
  });

  // Transform gesture (story 8: gesture start/end close the capture window
  // so a whole drag/resize is exactly one undo step)
  const gesture = useTransformGesture({
    doc,
    camera: cam.camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    onGestureStart: undo.boundary,
    onGestureEnd: undo.boundary,
  });

  // Create sticky at a screen point (disabled when load_failed)
  const createStickyAtScreen = useCallback((screenPoint: Point) => {
    if (!canEdit(connectionState)) return;
    const worldPoint = screenToWorld(cam.camera, screenPoint);
    undo.boundary();
    const id = createSticky(doc, worldPoint);
    undo.boundary();
    if (id) {
      selection.startEdit(id);
    }
  }, [cam.camera, doc, selection, connectionState, undo]);

  // Create sticky at viewport centre (toolbar button / N key)
  const createStickyAtCentre = useCallback(() => {
    const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
    createStickyAtScreen(centre);
  }, [viewport, createStickyAtScreen]);

  // Create text at a screen point (story 9: Text tool)
  const createTextAtScreen = useCallback((screenPoint: Point) => {
    if (!canEdit(connectionState)) return;
    const worldPoint = screenToWorld(cam.camera, screenPoint);
    undo.boundary();
    const id = createText(doc, worldPoint, 'local');
    undo.boundary();
    if (id) {
      setTool('select');
      selection.setMany([id], false);
      selection.startEdit(id);
    }
  }, [cam.camera, doc, selection, connectionState, undo, setTool]);

  // Remeasure text box after local changes (story 9)
  const remeasureText = useCallback((id: string) => {
    const objects = doc.getMap('objects');
    const obj = objects.get(id) as Y.Map<unknown> | undefined;
    if (!obj || obj.get('type') !== 'text') return;
    const ytext = obj.get('text') as Y.Text | undefined;
    if (!ytext) return;
    const text = ytext.toString();
    const size = (obj.get('size') as string) ?? 'M';
    const widthMode = (obj.get('widthMode') as string) ?? 'auto';
    const storedWidth = obj.get('width') as number | undefined;
    const fontSize = TEXT_SIZES[size as keyof typeof TEXT_SIZES] ?? 20;

    // Simple estimate: char count × fontSize × 0.6
    let estimatedWidth: number;
    let lineCount: number;

    if (widthMode === 'fixed' && storedWidth) {
      estimatedWidth = storedWidth;
      // Estimate lines based on width
      const charsPerLine = Math.max(1, Math.floor(storedWidth / (fontSize * 0.6)));
      const paragraphs = text.split('\n');
      lineCount = paragraphs.reduce((acc, p) => acc + Math.max(1, Math.ceil(p.length / charsPerLine)), 0);
    } else {
      // Auto width: longest line
      const paragraphs = text.split('\n');
      const longest = paragraphs.reduce((max, p) => Math.max(max, p.length), 0);
      estimatedWidth = Math.min(longest * fontSize * 0.6, TEXT_MAX_AUTO_WIDTH_WORLD);
      lineCount = paragraphs.length;
    }

    const estimatedHeight = Math.max(1, lineCount) * fontSize * TEXT_LINE_HEIGHT;
    setTextBox(doc, id, { width: estimatedWidth, height: estimatedHeight });
  }, [doc]);

  // Keyboard commands
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: editable, undo, tool, onCreateStickyAtCentre: createStickyAtCentre });

  // Handle double-click on empty board space
  const handleDblClickEmpty = useCallback((screenPoint: Point) => {
    if (tool === 'text') {
      createTextAtScreen(screenPoint);
    } else {
      createStickyAtScreen(screenPoint);
    }
  }, [tool, createStickyAtScreen, createTextAtScreen]);

  // Handle click on empty board space
  const handleClickEmpty = useCallback(() => {
    selection.clear();
  }, [selection]);

  // Handle click on empty board space with point (for text tool)
  const handleClickEmptyWithPoint = useCallback((screenPoint: Point) => {
    if (tool === 'text') {
      createTextAtScreen(screenPoint);
    } else {
      selection.clear();
    }
  }, [tool, createTextAtScreen, selection]);

  // Handle double-click on a note (start editing)
  const handleNoteDblClick = useCallback((_e: React.MouseEvent, id: string) => {
    if (editable) {
      selection.startEdit(id);
    }
  }, [selection, editable]);

  // Handle end edit from the text editor
  const handleEndEdit = useCallback((_next: 'selected' | 'unselected', id?: string) => {
    if (id) {
      // For text objects: check if empty and delete
      deleteIfEmpty(doc, id);
      // Prune selection if object was deleted
      const objects = doc.getMap('objects');
      if (!objects.get(id)) {
        selection.clear();
        return;
      }
    }
    selection.endEdit();
  }, [doc, selection]);

  // Compute selection bar position (above bounding box in screen space)
  const selectedObjects = notes.filter(n => selection.ids.has(n.id));
  const bbox = unionRects(selectedObjects.map(o => objectBounds(o)));
  let barStyle: React.CSSProperties | undefined;
  if (bbox && selection.ids.size > 0) {
    const topLeft = worldToScreen(cam.camera, { x: bbox.x, y: bbox.y });
    barStyle = {
      position: 'absolute',
      left: topLeft.x + (bbox.width * cam.camera.zoom) / 2,
      top: topLeft.y - 8,
      transform: 'translate(-50%, -100%)',
      zIndex: 100,
    };
  }

  // Handle delete selection (story 8: one undo step of any size)
  const handleDeleteSelection = useCallback(() => {
    if (!editable) return;
    undo.boundary();
    deleteObjects(doc, [...selection.ids]);
    undo.boundary();
    selection.clear();
  }, [doc, selection, editable, undo]);

  // Cursor style based on active tool
  const cursorStyle = tool === 'text' ? 'text' : 'grab';

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cam.camera}
        beginPan={cam.beginPan}
        panMove={cam.panMove}
        endPan={cam.endPan}
        wheel={cam.wheel}
        zoomIn={cam.zoomIn}
        zoomOut={cam.zoomOut}
        reset={cam.reset}
        onDblClickEmpty={handleDblClickEmpty}
        onClickEmpty={handleClickEmpty}
        onClickEmptyWithPoint={handleClickEmptyWithPoint}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
        cursorStyle={cursorStyle}
        textToolActive={tool === 'text'}
      >
        {notes.map((note) => {
          if (note.type === 'text') {
            return (
              <TextObject
                key={note.id}
                obj={note}
                doc={doc}
                zoom={cam.camera.zoom}
                selected={selection.ids.has(note.id)}
                editing={selection.editingId === note.id}
                onPointerDown={gesture.onObjectPointerDown}
                onDblClick={handleNoteDblClick}
                onEndEdit={(next) => handleEndEdit(next, note.id)}
                undo={undo}
              />
            );
          }
          return (
            <StickyNote
              key={note.id}
              note={note as any}
              doc={doc}
              zoom={cam.camera.zoom}
              selected={selection.ids.has(note.id)}
              editing={selection.editingId === note.id}
              onPointerDown={gesture.onObjectPointerDown}
              onDblClick={handleNoteDblClick}
              onEndEdit={handleEndEdit}
              undo={undo}
            />
          );
        })}
        {/* Marquee rectangle in world space */}
        <MarqueeRect rect={marquee.rect} camera={cam.camera} />
      </BoardViewport>

      {/* Selection overlay (screen space) */}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={cam.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />

      {/* Selection bar (screen space, positioned above bounding box) */}
      {barStyle && (
        <div style={barStyle}>
          <SelectionBar
            ids={selection.ids}
            snapshot={notes}
            doc={doc}
            onDelete={handleDeleteSelection}
            undo={undo}
            onRemeasure={remeasureText}
          />
        </div>
      )}

      <Toolbar
        onCreateSticky={createStickyAtCentre}
        disabled={!editable}
        undo={undoState}
        tool={tool}
        setTool={setTool}
      />
      <ZoomControls
        zoomPercent={cam.zoomPercent}
        canZoomIn={cam.canZoomIn}
        canZoomOut={cam.canZoomOut}
        onZoomIn={cam.zoomIn}
        onZoomOut={cam.zoomOut}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated && notes.length === 0} />
    </>
  );
}
