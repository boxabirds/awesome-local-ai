import * as React from 'react';
import * as Y from 'yjs';
import { screenToWorld } from '../canvas/camera';
import { useCamera } from '../canvas/useCamera';
import { createSticky, deleteObjects as modelDeleteObjects } from '../../shared/board-model';
import { STICKY_SIZE_WORLD } from '../../shared/config';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { Toolbar } from './Toolbar';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import { SelectionBar } from './SelectionBar';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { useVidi6TestHook } from '../testHooks';
import { useTransformGesture } from './useTransformGesture';
import { useBoardKeys } from './useBoardKeys';
import { createUndo } from './undo';
import { useUndo } from './useUndo';
import type { UndoController } from './undo';
import { useTool, type Tool } from './useTool';
import { createText, setTextSize, getTextContent, isEmptyText, deleteIfEmpty } from '../../shared/objects/text';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface BoardAppProps {
  boardId: string;
}

export function BoardApp(props: BoardAppProps): React.JSX.Element {
  const [viewportSize, setViewportSize] = React.useState<{ width: number; height: number }>({
    width: window.innerWidth || 1280,
    height: window.innerHeight || 800,
  });

  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setViewportSize({ width, height });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- Connect to durable object ----
  const { doc, snapshots, connectionState, canEdit, ConnectionStatus: CS } = useBoardDoc(
    props.boardId,
  );

  const hook = useCamera(viewportSize);
  const selection = useSelection(snapshots, doc);

  // ---- Undo controller (story 8) ----
  const controllerRef = React.useRef<UndoController | null>(null);

  // Create/destroy controller when board changes
  React.useEffect(() => {
    // Destroy previous controller
    controllerRef.current?.destroy();
    controllerRef.current = null;

    // Only create when we have a real doc
    if (doc && connectionState === 'connected') {
      controllerRef.current = createUndo(doc);
    }

    return () => {
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, [props.boardId]); // destroy on board change

  // Clean up controller when unmounting (session only)
  React.useEffect(() => {
    return () => {
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, []);

  const canEditBool = !!canEdit;
  const undoProps = useUndo(controllerRef.current, canEditBool);
  const boundary = React.useCallback(() => {
    controllerRef.current?.boundary();
  }, []);

  // Hook into camera state for e2e test assertions
  useVidi6TestHook(hook.setRawCamera);

  // ---- Story 9: Tool mode ----
  const { tool: activeTool, setTool } = useTool(canEditBool);

  // ---- Gesture hooks ----
  const gesture = useTransformGesture({
    doc: doc!,
    camera: hook.camera,
    selection,
    snapshot: snapshots,
    canEdit: !!canEdit,
    onGestureStart: boundary,
    onGestureEnd: boundary,
  });

  // Keyboard handler
  useBoardKeys({
    doc: doc!,
    selection,
    snapshot: snapshots,
    canEdit: !!canEdit,
    editingId: selection.editingId,
    undo: undoProps.undo,
    redo: undoProps.redo,
    canUndo: undoProps.canUndo,
    canRedo: undoProps.canRedo,
    activeTool,
    onToolChange: setTool,
  });

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  const handleCreateStickyAtWorld = React.useCallback(
    (worldPoint: { x: number; y: number }) => {
      const id = createSticky(doc, worldPoint);
      if (id) selection.startEdit(id);
    },
    [doc],
  );

  // Handle N key → create sticky at view centre (story 2 regression)
  const handleNKey = React.useCallback(() => {
    handleCreateStickyAtWorld(screenToWorld(hook.camera, {
      x: viewportSize.width / 2,
      y: viewportSize.height / 2,
    }));
  }, [handleCreateStickyAtWorld, hook.camera, viewportSize]);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const pt = (e as CustomEvent).detail as { x: number; y: number };
      handleCreateStickyAtWorld(pt);
    };
    window.addEventListener('vidi6:createSticky', handler);
    return () => window.removeEventListener('vidi6:createSticky', handler);
  }, [handleCreateStickyAtWorld]);

  // Handle text creation via click in text tool
  const handleTextClick = React.useCallback(
    (worldPoint: { x: number; y: number }) => {
      if (!doc || !canEditBool) return;
      const id = createText(doc, worldPoint, 'local');
      if (id) {
        selection.startEdit(id);
        setTool('select');
      }
    },
    [doc, canEditBool, selection, setTool],
  );

  // Listen for VIDI6 text create events from BoardViewport
  React.useEffect(() => {
    const handler = (e: Event) => {
      const pt = (e as CustomEvent).detail as { x: number; y: number };
      handleTextClick(pt);
    };
    window.addEventListener('vidi6:createText', handler);
    return () => window.removeEventListener('vidi6:createText', handler);
  }, [handleTextClick]);

  // Handle additive selection from marquee
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ids = (e as CustomEvent).detail as string[];
      if (ids.length > 0) {
        selection.setMany(ids, true);
      }
    };
    window.addEventListener('vidi6:addSelection', handler);
    return () => window.removeEventListener('vidi6:addSelection', handler);
  }, [selection]);

  // Handle clear selection from empty click
  React.useEffect(() => {
    const handler = () => {
      selection.clear();
    };
    window.addEventListener('vidi6:clearSelection', handler);
    return () => window.removeEventListener('vidi6:clearSelection', handler);
  }, [selection]);

  const handleSelect = React.useCallback(
    (id: string) => {
      if (selection.editingId === id) return;
      selection.click(id);
    },
    [selection.editingId],
  );

  const handleSetColor = React.useCallback(
    (_color: string) => {},
    [],
  );

  const handleDeleteSelection = React.useCallback(() => {
    if (doc && selection.ids.size > 0) {
      const idsToDelete = [...selection.ids];
      selection.clear();
      Promise.resolve().then(() => {
        modelDeleteObjects(doc, idsToDelete);
      });
    }
  }, [doc, selection.ids]);

  // Story 9: Text tool clicks — translate screen coordinates to world and dispatch event
  React.useEffect(() => {
    // Override pointer down on viewport background when text tool is active
    // This is handled in BoardViewport which dispatches vidi6:createText
  }, []);

  // Story 9: Size change handler from TextToolbar
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; size: string };
      if (!doc) return;
      setTextSize(doc, detail.id, detail.size);
    };
    window.addEventListener('vidi6:textSize', handler);
    return () => window.removeEventListener('vidi6:textSize', handler);
  }, [doc]);

  // Story 9: Delete handler from TextToolbar
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { ids: string[] };
      if (!doc) return;
      modelDeleteObjects(doc, detail.ids);
      selection.clear();
    };
    window.addEventListener('vidi6:deleteObjects', handler);
    return () => window.removeEventListener('vidi6:deleteObjects', handler);
  }, [doc, selection]);

  // Ctrl/Cmd zoom shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (!ctrlOrMeta) return;
      switch (e.key) {
        case '=': case '+': case 'Equal': e.preventDefault(); hook.zoomIn(); break;
        case '-': case 'Minus': e.preventDefault(); hook.zoomOut(); break;
        case '0': e.preventDefault(); hook.reset(); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hook]);

  // Render viewport children (text objects + sticky notes)
  const renderWorldLayer = React.useMemo(() => {
    const elements: React.ReactNode[] = [];
    
    for (const obj of snapshots) {
      if (obj.type === 'sticky') continue; // already rendered by BoardViewport
      
      // For text objects and other types, render via their registered component
      if (obj.type === 'text' && obj.id) {
        elements.push(
          <TextObjectRenderable
            key={obj.id}
            obj={obj}
            zoom={hook.camera.zoom}
            selected={!!selection.ids.has(obj.id)}
            editing={selection.editingId === obj.id}
            camera={hook.camera}
            onSelect={handleSelect}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
            onPointerDown={gesture.onObjectPointerDown}
            undo={undoProps.undo}
            redo={undoProps.redo}
          />,
        );
      }
    }
    
    return elements;
  }, [snapshots, hook.camera, selection.ids, selection.editingId, handleSelect, selection.startEdit, selection.endEdit, gesture, undoProps, undoProps.redo]);

  return (
    <div ref={rootRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* Connection status badge */}
      <CS state={connectionState} />

      {/* Selection bar */}
      <SelectionBar
        ids={selection.ids}
        snapshot={snapshots}
        doc={doc}
        onDelete={handleDeleteSelection}
      />

      {/* Toolbar (top-left) */}
      <Toolbar
        onCreateSticky={() => handleCreateStickyAtWorld(screenToWorld(hook.camera, {
          x: viewportSize.width / 2,
          y: viewportSize.height / 2,
        }))}
        undoProps={undoProps}
        activeTool={activeTool}
        onToolChange={canEditBool ? setTool : undefined}
      />

      {/* Main canvas */}
      <BoardViewport
        camera={hook.camera}
        useCameraHook={hook}
        snapshosts={snapshots}
        doc={doc}
        selectedIds={selection.ids}
        editingId={selection.editingId}
        onSelect={handleSelect}
        onStartEdit={selection.startEdit}
        onEndEdit={selection.endEdit}
        onMove={undefined}
        onBringToFront={undefined}
        onDelete={undefined}
        onObjectPointerDown={gesture.onObjectPointerDown}
        onHandlePointerDown={gesture.onHandlePointerDown}
        undo={undoProps.undo}
        redo={undoProps.redo}
        activeTool={activeTool}
      >
        {renderWorldLayer}
      </BoardViewport>

      {/* Sticky note toolbar (appears near selected sticky — single note only) */}
      {selection.ids.size === 1 && !selection.editingId && (() => {
        const note = snapshots.find((s) => s.id === [...selection.ids][0]);
        if (!note) return null;
        const cx = note.x + STICKY_SIZE_WORLD / 2;
        const cy = note.y - 40;
        const screenX = (cx - hook.camera.x) * hook.camera.zoom;
        const screenY = (cy - hook.camera.y) * hook.camera.zoom;
        return (
          <div
            style={{
              position: 'fixed',
              left: `${screenX}px`,
              top: `${screenY}px`,
              transform: 'translate(-50%, 0)',
              zIndex: 100,
              pointerEvents: 'auto',
            }}
          >
            <NoteToolbar
              color={note.color as any}
              onColor={handleSetColor}
              onDelete={() => {
                if (doc) {
                  const id = note.id;
                  selection.clear();
                  modelDeleteObjects(doc, [id]);
                }
              }}
            />
          </div>
        );
      })()}

      {/* Text toolbar (appears above selected text — single text only) */}
      {selection.ids.size === 1 && !selection.editingId && (() => {
        const note = snapshots.find((s) => s.id === [...selection.ids][0]);
        if (!note || note.type !== 'text') return null;
        
        // Mark as single text selection for TextObject
        (window as any).__vidi6SingleSelection = note.id;
        
        const w = (note.width ?? 600) as number;
        const cx = note.x + w / 2;
        const cy = note.y - 36;
        const screenX = (cx - hook.camera.x) * hook.camera.zoom;
        const screenY = (cy - hook.camera.y) * hook.camera.zoom;
        return (
          <div
            style={{
              position: 'fixed',
              left: `${screenX}px`,
              top: `${screenY}px`,
              transform: 'translate(-50%, 0)',
              zIndex: 100,
              pointerEvents: 'auto',
            }}
          >
            <TextToolbar
              size={(note.size as any) || 'M'}
              onSize={(s) => {
                if (doc) setTextSize(doc, note.id, s);
              }}
              onDelete={() => {
                if (doc) {
                  selection.clear();
                  modelDeleteObjects(doc, [note.id]);
                }
              }}
            />
          </div>
        );
      })()}

      {/* Zoom controls (bottom-right) */}
      <ZoomControls
        zoomPercent={hook.percent}
        canZoomIn={hook.canZoomIn}
        canZoomOut={hook.canZoomOut}
        onZoomIn={hook.zoomIn}
        onZoomOut={hook.zoomOut}
        onReset={hook.reset}
      />
      <NavigationHint visible={hook.hasNavigated} />
    </div>
  );
}

// Internal component to render individual text objects from snapshots
function TextObjectRenderable({
  obj,
  zoom,
  selected,
  editing,
  camera,
  onSelect,
  onStartEdit,
  onEndEdit,
  onPointerDown,
  undo,
  redo,
}: {
  obj: ObjectSnapshot;
  zoom: number;
  selected: boolean;
  editing: boolean;
  camera: { x: number; y: number; zoom: number };
  onSelect?: (id: string) => void;
  onStartEdit?: (id: string) => void;
  onEndEdit?: (next: 'selected' | 'unselected') => void;
  onPointerDown?: (e: PointerEvent, id: string) => void;
  undo?: () => void;
  redo?: () => void;
}): React.JSX.Element {
  const w = (obj.width ?? 600) as number;
  const h = (obj.height ?? 26) as number;
  
  return (
    <div
      className={`text-object${selected ? ' text-object--selected' : ''}${editing ? ' text-object--editing' : ''}`}
      data-selected={selected}
      data-object-id={obj.id}
      role="group"
      aria-label={`Text: ${(obj.text as string) || ''}`}
      tabIndex={selected ? 0 : -1}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown?.(e.nativeEvent, obj.id);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (onSelect && !editing) onSelect(obj.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (onStartEdit) onStartEdit(obj.id);
      }}
      style={{
        position: 'absolute',
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        width: `${w}px`,
        height: `${h}px`,
        cursor: editing ? 'text' : 'default',
        transformOrigin: '0 0',
        userSelect: editing ? 'text' : 'none',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          fontSize: `${(parseFloat(String(obj.z)) ? 20 : 20)}px`,
          fontFamily: 'Inter, system-ui, sans-serif',
          color: '#333',
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word',
          lineHeight: '1.3',
          padding: '4px 8px',
          boxSizing: 'border-box',
          overflow: 'hidden',
          textAlign: 'left',
          minHeight: 0,
        }}
      >
        {(obj.text as string) || '\u00A0'}
      </div>
      
      {selected && !editing && (
        <div
          style={{
            position: 'absolute',
            inset: '-2px',
            border: '2px solid #1a73e8',
            pointerEvents: 'none',
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
