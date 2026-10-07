import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { TextObject } from './objects/TextObject';
import { ShapeObject } from './objects/ShapeObject';
import { ShapeToolbar } from './objects/ShapeToolbar';
import { ConnectorObject } from './objects/ConnectorObject';
import { ShapeTool } from './tools/ShapeTool';
import { ConnectorTool } from './tools/ConnectorTool';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { MarqueeRect } from './board/Marquee';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { useActiveTool } from './tools/useActiveTool';
import { useTool } from './board/useTool';
import { SHAPE_LABEL_MAX_CHARS, STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR, TEXT_SIZES, DEFAULT_TEXT_SIZE } from '@/shared/config';
import { createSticky, deleteObjects as deleteObj, snapshot, initDoc, moveObjects } from '@/shared/board-model';
import { createText, setTextWidthFixed, setTextSize, getTextContent, isEmptyText, setTextBox } from '@/shared/objects/text';
import { setShapeStyle, getShapeLabel } from '@/shared/objects/shape';
import type { FillColor, StrokeColor } from '@/shared/objects/shape';
import { layoutText, createCanvasMeasurer } from '@/client/objects/textLayout';
import type { StickySnapshot, ObjectSnapshot } from '@/shared/board-model';
import type { Handle, ObjectTypeSpec } from '@/client/objects/registry';
import { registerObjectType, stickyHitTest, textHitTest } from '@/client/objects/registry';
import { useRoute, navigate } from './router';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SharePanel } from './share/SharePanel';
import { createUndo } from './board/undo';
import { useUndo } from './board/useUndo';
import { useTextBoxSync } from '@/client/objects/useTextBoxSync';

let docRef: Y.Doc | null = null;

/** Main app — routes to HomePage, BoardPage, or NotFoundPage based on URL. */
export function App(): ReactNode {
  const route = useRoute();

  if (route.name === 'home') {
    return <HomePage />;
  }

  if (route.name === 'not_found') {
    return <NotFoundPage onCreateBoard={() => navigate('/')} />;
  }

  const boardId = route.id;
  const { doc, snap, connectionState } = useBoardDoc(boardId);
  const snaps = snap as unknown as readonly ObjectSnapshot[];
  const { ids, editingId, click, toggle, setMany, clear: clearSelection, startEdit, endEdit } = useSelection(snap);

  // Disable editing when persistence is broken
  const canEdit =
    connectionState === 'connected' ||
    connectionState === 'connecting' ||
    connectionState === 'reconnecting' ||
    connectionState === 'confirmed';

  // ---- Tool mode ----
  const { tool, shapeKind, setTool, setShapeKind, toolCreated: onToolCreated } = useActiveTool({ canEdit });

  /** Called when a shape or connector is created — select it and switch to Select. */
  const handleToolCreated = useCallback(
    (id: string) => {
      click(id);
      onToolCreated(id);
    },
    [click, onToolCreated],
  );

  // ---- Camera ref ----
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });

  // ---- Undo controller ----
  const undoControllerRef = useRef<ReturnType<typeof createUndo> | null>(null);
  const prevBoardIdRef = useRef<string | undefined>(boardId);

  useEffect(() => {
    if (boardId !== prevBoardIdRef.current && undoControllerRef.current) {
      undoControllerRef.current.destroy();
      undoControllerRef.current = null;
    }
    prevBoardIdRef.current = boardId;

    if (!undoControllerRef.current && doc) {
      const objectsMap = doc.getMap('objects');
      undoControllerRef.current = createUndo(doc);
    }
  }, [doc, boardId]);

  const undoState = useUndo(undoControllerRef.current, canEdit);

  // ---- Register object types (once per board lifecycle) ----
  const stickyCompRef = useRef<any>(null);
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!stickyCompRef.current || !doc) return;
    if (registeredRef.current) return;
    registeredRef.current = true;

    registerObjectType('sticky', {
      Component: stickyCompRef.current,
      resizable: true,
      aspectLocked: false,
      minSize: STICKY_SIZE_WORLD / 2,
      editableText: true,
      hitTest: stickyHitTest,
    });
    registerObjectType('text', {
      Component: TextObject as any,
      resizable: true,
      aspectLocked: false,
      minSize: 40,
      editableText: true,
      handles: 'horizontal',
      hitTest: textHitTest,
    });
    registerObjectType('shape', {
      Component: ShapeObject as any,
      resizable: true,
      aspectLocked: false,
      minSize: SHAPE_LABEL_MAX_CHARS > 0 ? 20 : 20,
      editableText: true,
      hitTest: (obj: ObjectSnapshot, wp: { x: number; y: number }) =>
        wp.x >= obj.x && wp.y >= obj.y && wp.x <= (obj.x + (obj.width ?? 100)) && wp.y <= (obj.y + (obj.height ?? 100)),
    });
    registerObjectType('connector', {
      Component: ConnectorObject as any,
      resizable: false,
      aspectLocked: false,
      minSize: 0,
      editableText: false,
      hitTest: () => true, // handled specially in BoardViewport
    });
  }, [doc]);

  // Store component reference before registration
  useEffect(() => {
    stickyCompRef.current = StickyNote;
  }, []);

  // ---- Canvas measurer ----
  const measurerRef = useRef(createCanvasMeasurer());

  // ---- Box sync remeasure callback (for TextObject's onRemeasure) ----
  const [remeasureTarget, setRemeasureTarget] = useState<string | null>(null);

  const handleRemeasure = useCallback((id: string) => {
    setRemeasureTarget(id);
  }, []);

  // Perform the actual remeasure
  useEffect(() => {
    if (!remeasureTarget || !doc) return;

    const objectsMap = doc.getMap('objects') as Y.Map<any>;
    const innerRaw = objectsMap.get(remeasureTarget);
    if (!innerRaw || typeof (innerRaw as any).get !== 'function') return;
    const inner = innerRaw as any;

    const sizeKey = ((inner.get('size') ?? 'M') as string) as keyof typeof TEXT_SIZES;
    const widthMode = ((inner.get('widthMode') ?? 'auto') as string) as 'auto' | 'fixed';
    const storedWidth = Number(inner.get('width')) || 0;

    const textVal = getTextContent(doc, remeasureTarget);
    if (!textVal) return;

    const textStr = textVal.toString();
    const fixedW = widthMode === 'fixed' ? storedWidth : null;

    const result = layoutText(textStr, sizeKey, widthMode, fixedW, measurerRef.current);

    // Only write if different
    const curW = inner.get('width');
    const curH = inner.get('height');
    if (curW === result.width && curH === result.height) return;

    setTextBox(doc, remeasureTarget, result);
    setRemeasureTarget(null);
  }, [remeasureTarget, doc]);

  // ---- Create sticky note at top-left world position ----
  const handleCreateStickyAt = useCallback(
    (worldX: number, worldY: number) => {
      if (!canEdit) return;
      undoControllerRef.current?.boundary();
      const id = createSticky(doc, { x: worldX, y: worldY }, DEFAULT_STICKY_COLOR);
      if (id) {
        click(id);
        startEdit(id);
      }
    },
    [doc, click, startEdit, canEdit, undoControllerRef],
  );

  // ---- Create sticky at view centre ----
  const handleCreateStickyAtViewCentre = useCallback(() => {
    if (!canEdit) return;
    undoControllerRef.current?.boundary();
    const cam = cameraRef.current;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const wpX = vw / cam.zoom + cam.x - STICKY_SIZE_WORLD / 2;
    const wpY = vh / cam.zoom + cam.y - STICKY_SIZE_WORLD / 2;
    handleCreateStickyAt(wpX, wpY);
  }, [canEdit, handleCreateStickyAt]);

  // ---- Create text on board click ----
  const handleClickBoard = useCallback(
    (screenX: number, screenY: number) => {
      if (!doc || !canEdit) return;

      // Convert screen coords to world coords
      const cam = cameraRef.current;
      const worldX = (screenX - cam.x) / cam.zoom;
      const worldY = (screenY - cam.y) / cam.zoom;

      const id = createText(doc, { x: worldX, y: worldY }, 'local-user');
      if (!id) return;

      // Switch to Select and start editing
      setTool('select');
      click(id);
      startEdit(id);
    },
    [doc, canEdit, setTool, click, startEdit],
  );

  const handleDblClickEmpty = useCallback(
    (worldX: number, worldY: number) => {
      handleCreateStickyAt(worldX, worldY);
    },
    [handleCreateStickyAt],
  );

  const handleClickEmpty = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  // ---- Delete selection bar handler ----
  const handleDeleteSelection = useCallback(() => {
    if (ids.size === 0) return;
    undoControllerRef.current?.boundary();
    deleteObj(doc, Array.from(ids));
    clearSelection();
  }, [doc, ids, clearSelection, undoControllerRef]);

  // ---- Text-specific handlers ----
  const handleTextSizeChange = useCallback(
    (objId: string, size: keyof typeof TEXT_SIZES) => {
      setTextSize(doc, objId, size);
    },
    [doc],
  );

  const handleTextDelete = useCallback(() => {
    if (editingId && doc) {
      undoControllerRef.current?.boundary();
      deleteObj(doc, [editingId]);
      endEdit();
      clearSelection();
    }
  }, [editingId, doc, endEdit, clearSelection, undoControllerRef]);

  // ---- Keyboard shortcuts ----
  useBoardKeys({
    doc,
    selectedIds: ids,
    snapshot: snaps,
    canEdit,
    isEditing: editingId !== null,
    setMany,
    clear: clearSelection,
    tool,
    setTool,
    onCreateStickyCenter: handleCreateStickyAtViewCentre,
    undoController: undoControllerRef.current,
  });

  // ---- Transform gesture ----
  const gesture = useTransformGesture({
    doc,
    camera: cameraRef.current,
    selectedIds: ids,
    snapshot: snaps,
    canEdit,
    isEditing: editingId !== null,
    onGestureStart: () => {
      undoControllerRef.current?.boundary();
    },
    onGestureEnd: () => {
      undoControllerRef.current?.boundary();
    },
  });

  // ---- Check if exactly one text is selected ----
  const singleTextEdit = ids.size === 1 ? [...ids][0] : null;
  const singleTextObj = singleTextEdit ? snaps.find(s => s.id === singleTextEdit && s.type === 'text') : null;

  // ---- Render all objects sorted by z/id ----
  const renderedObjects = useMemo(() => {
    const results: ReactNode[] = [];

    for (const s of snaps) {
      if (s.type === 'sticky') {
        const isSelected = ids.has(s.id);
        const isSelectedOnly = isSelected && ids.size === 1;
        results.push(
          <StickyNote
            key={s.id}
            note={s}
            doc={doc}
            zoom={cameraRef.current.zoom}
            selected={isSelected}
            editing={editingId === s.id}
            isSelectedOnly={isSelectedOnly}
            onSelect={(id) => click(id)}
            onStartEdit={startEdit}
            onEndEdit={() => endEdit()}
            onObjectPointerDown={gesture.onObjectPointerDown as any}
            undoController={undoControllerRef.current}
          />,
        );
      } else if (s.type === 'text') {
        const isSelected = ids.has(s.id);
        results.push(
          <TextObject
            key={s.id}
            obj={s}
            doc={doc}
            zoom={cameraRef.current.zoom}
            selected={isSelected}
            editing={editingId === s.id}
            onSelect={(id) => click(id)}
            onStartEdit={startEdit}
            onEndEdit={() => endEdit()}
            onObjectPointerDown={(_e: PointerEvent, _id: string) => { /* handled via gesture */ }}
            onRemeasure={handleRemeasure}
            undoController={undoControllerRef.current}
          />,
        );
      } else if (s.type === 'shape') {
        const isSelected = ids.has(s.id);
        results.push(
          <ShapeObject
            key={s.id}
            shape={s as any}
            doc={doc}
            zoom={cameraRef.current.zoom}
            selected={isSelected}
            editing={editingId === s.id}
            onSelect={(id) => click(id)}
            onStartEdit={startEdit}
            onEndEdit={() => endEdit()}
            onObjectPointerDown={gesture.onObjectPointerDown as any}
          />,
        );
      } else if (s.type === 'connector') {
        // Build rects map for connector resolution
        const rectsMap = new Map<string, { x: number; y: number; width: number; height: number }>();
        for (const snap of snaps) {
          rectsMap.set(snap.id, { x: snap.x, y: snap.y, width: snap.width ?? 100, height: snap.height ?? 100 });
        }
        const isSelected = ids.has(s.id);
        results.push(
          <ConnectorObject
            key={s.id}
            connector={s as any}
            rects={rectsMap}
            doc={doc}
            zoom={cameraRef.current.zoom}
            selected={isSelected}
            editing={editingId === s.id}
            onSelect={(id) => click(id)}
            onStartEdit={() => {}}
            onEndEdit={() => {}}
            onObjectPointerDown={(_e: React.PointerEvent, _id: string) => { /* handled via gesture */ }}
          />,
        );
      }
    }

    return results;
  }, [snaps, ids, editingId, click, startEdit, endEdit, gesture, cameraRef.current.zoom, doc, handleRemeasure]);

  // ---- Build a list of all object snapshots for overlay ----
  const allSnapshots: readonly ObjectSnapshot[] = snaps;

  // ---- Render ----
  return (
    <>
      <ConnectionStatus state={connectionState} />
      <Toolbar
        onCreateSticky={() => {
          const cam = cameraRef.current;
          const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
          const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
          const wpX = vw / cam.zoom + cam.x - STICKY_SIZE_WORLD / 2;
          const wpY = vh / cam.zoom + cam.y - STICKY_SIZE_WORLD / 2;
          handleCreateStickyAt(wpX, wpY);
        }}
        canUndo={undoState.canUndo}
        canRedo={undoState.canRedo}
        undo={undoState.undo}
        redo={undoState.redo}
        tool={tool}
        setTool={setTool}
        canEdit={canEdit}
        shapeKind={shapeKind}
        setShapeKind={setShapeKind}
      />
      <SharePanel boardId={boardId} />
      {/* Shape toolbar — shown when exactly one shape is selected */}
      {(() => {
        const singleId = ids.size === 1 ? [...ids][0] : null;
        const shape = singleId ? allSnapshots.find(s => s.id === singleId && s.type === 'shape') : null;
        if (!shape) return null;
        return (
          <ShapeToolbar
            fill={'white'}
            stroke={'dark'}
            onFill={(c) => {
              setShapeStyle(doc, shape.id!, { fill: c });
            }}
            onStroke={(c) => {
              setShapeStyle(doc, shape.id!, { stroke: c });
            }}
          />
        );
      })()}
      <SelectionBar
        ids={ids}
        snapshot={allSnapshots}
        onDelete={handleDeleteSelection}
        onSizeChange={handleTextSizeChange}
        onTextDelete={handleTextDelete}
      />
      <BoardViewport
        onCameraChange={(cam) => {
          cameraRef.current = cam;
        }}
        onDblClickEmpty={handleDblClickEmpty}
        onClickEmpty={handleClickEmpty}
        onClickBoard={handleClickBoard}
        tool={tool}
        selectedIds={ids}
        onSelect={(idsList) => setMany(idsList, true)}
        isEditing={editingId !== null}
        snapshot={snaps}
      >
        {/* Shape and Connector tools render overlays in world layer */}
        {(tool === 'shape' || tool === 'connector') && (
          <g
            data-layer="tools"
            style={{ transformOrigin: '0 0', transform: `scale(${cameraRef.current.zoom}) translate(${-cameraRef.current.x}px, ${-cameraRef.current.y}px)` }}
          >
            {tool === 'shape' && (
              <ShapeTool
                kind={shapeKind}
                camera={cameraRef.current}
                doc={doc}
                onCreated={handleToolCreated}
              />
            )}
            {tool === 'connector' && (
              <ConnectorTool
                camera={cameraRef.current}
                snapshot={snaps}
                onCreated={handleToolCreated}
              />
            )}
          </g>
        )}
        {renderedObjects}
        <SelectionOverlay
          ids={ids}
          snapshot={allSnapshots}
          camera={cameraRef.current}
          onHandlePointerDown={(_e: PointerEvent, h: Handle) => {
            // Resize is handled via the gesture system
          }}
        />
      </BoardViewport>
    </>
  );
}
