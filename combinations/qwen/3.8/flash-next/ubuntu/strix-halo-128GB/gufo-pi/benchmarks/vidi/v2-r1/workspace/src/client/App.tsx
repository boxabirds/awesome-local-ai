import { useCallback, useEffect, useMemo, useRef } from 'react';

import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point } from './canvas/camera';
import { useCamera, useViewportSize } from './canvas/useCamera';
import { TEST_MODE } from './canvas/testHooks';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useBoardKeys } from './board/useBoardKeys';
import { useTransformGesture } from './board/useTransformGesture';
import { useUndo } from './board/useUndo';
import { useTool } from './board/useTool';
import { createUndo, type UndoController } from './board/undo';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { StickyNote } from './objects/StickyNote';
import { TextObject } from './objects/TextObject';
import { getObjectType } from './objects/registry';
import { createCanvasMeasurer, type Measurer } from './objects/textLayout';
import { createText } from '../shared/objects/text';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import { SharePanel } from './share/SharePanel';
import {
  createSticky,
  deleteObjects,
  objectSnapshots,
  objectsInRect,
  setStickyColor,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../shared/board-model';
import type { TextSnapshot } from '../shared/objects/text';

/**
 * The board: an infinite canvas (story 1) holding sticky notes (story 2) and
 * text objects (story 9), shared live with others (story 3), with multi-selection,
 * move, resize, nudge and delete (story 7), and per-user undo/redo (story 8).
 */
export function App(props: { boardId: string }) {
  const { boardId } = props;
  const viewport = useViewportSize();
  const cameraApi = useCamera(viewport);
  const { camera, hasNavigated } = cameraApi;
  const { doc, notes, connectionState } = useBoardDoc(boardId);

  // Object snapshots for group operations (must be computed before useSelection for prune)
  const objSnapshots: readonly ObjectSnapshot[] = useMemo(() => objectSnapshots(doc), [notes]);

  const selection = useSelection(objSnapshots);
  const editing = canEdit(connectionState);

  // Tool mode
  const { tool, setTool } = useTool(editing);

  // Text measurer (shared across all text objects)
  const measureRef = useRef<Measurer | null>(null);
  if (measureRef.current === null) {
    measureRef.current = createCanvasMeasurer();
  }
  const measure = measureRef.current;

  /** Latest camera, readable synchronously inside event handlers. */
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  // --- Undo controller (story 8) ---
  const undoRef = useRef<UndoController | null>(null);
  // Create one controller per doc; destroy on board change or unmount.
  useEffect(() => {
    const ctrl = createUndo(doc);
    undoRef.current = ctrl;
    return () => {
      ctrl.destroy();
      undoRef.current = null;
    };
  }, [doc]);

  const undoApi = useUndo(undoRef.current, editing);

  const undoBoundary = useCallback(() => {
    undoRef.current?.boundary();
  }, []);

  const undoCtrlRef = useMemo(
    () => ({
      undo: () => undoRef.current?.undo() ?? false,
      redo: () => undoRef.current?.redo() ?? false,
    }),
    [],
  );

  // Transform gesture — boundary on start and end
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objSnapshots,
    canEdit: editing,
    onGestureStart: undoBoundary,
    onGestureEnd: undoBoundary,
  });

  // Marquee selection
  const marquee = useMarquee(
    camera,
    objSnapshots,
    useCallback(
      (ids: string[]) => selection.setMany(ids, true),
      [selection],
    ),
    objectsInRect,
  );

  /** Create a note centred on a screen point of the board area (a double-click),
   * and start typing straight away. */
  const createAtScreenPoint = useCallback(
    (screen: Point) => {
      if (!editing) return;
      const world = screenToWorld(cameraRef.current, screen);
      undoBoundary();
      const id = createSticky(doc, world);
      undoBoundary();
      if (id !== '') {
        selection.click(id);
        selection.startEdit(id);
      }
    },
    [doc, selection, editing, undoBoundary],
  );

  /** Create a note in the middle of what the user can see. */
  const createAtCentre = useCallback(() => {
    if (!editing) return;
    createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreenPoint, viewport.height, viewport.width, editing]);

  /** Handle text tool click: create text at the clicked point, start editing, switch to Select. */
  const handleTextToolClick = useCallback(
    (screen: Point) => {
      if (!editing) return;
      const world = screenToWorld(cameraRef.current, screen);
      undoBoundary();
      const id = createText(doc, world, 'local');
      undoBoundary();
      if (id !== null) {
        setTool('select');
        selection.click(id);
        selection.startEdit(id);
      }
    },
    [doc, selection, editing, undoBoundary, setTool],
  );

  // Keyboard commands
  useBoardKeys({
    doc,
    selection,
    snapshot: objSnapshots,
    canEdit: editing,
    undo: undoApi.undo,
    redo: undoApi.redo,
    undoBoundary,
    tool,
    setTool,
    onCreateSticky: createAtCentre,
  });

  // Test-only hooks
  useEffect(() => {
    const hooks = TEST_MODE ? window.__vidi6 : undefined;
    if (!hooks) return undefined;
    const prevGetDoc = hooks.getDoc;
    const prevGetNoteCount = hooks.getNoteCount;
    const prevAddRandomNotes = hooks.addRandomNotes;
    hooks.getDoc = () => doc;
    hooks.getNoteCount = () => notes.length;
    hooks.addRandomNotes = (n: number) => {
      for (let i = 0; i < n; i++) {
        createSticky(doc, { x: (i % 50) * 220, y: Math.floor(i / 50) * 220 });
      }
    };
    hooks.addNoteAt = (pos: { x: number; y: number }) => createSticky(doc, pos);
    return () => {
      hooks.getDoc = prevGetDoc;
      hooks.getNoteCount = prevGetNoteCount;
      hooks.addRandomNotes = prevAddRandomNotes;
    };
  }, [doc, notes.length]);

  const handleDeleteSelection = useCallback(() => {
    if (!editing) return;
    undoBoundary();
    deleteObjects(doc, [...selection.ids]);
    undoBoundary();
    selection.clear();
  }, [doc, selection, editing, undoBoundary]);

  const handleColor = useCallback(
    (id: string, color: string) => {
      undoBoundary();
      setStickyColor(doc, id, color);
      undoBoundary();
    },
    [doc, undoBoundary],
  );

  // Determine if any selected type is resizable
  const anyResizable = useMemo(() => {
    for (const id of selection.ids) {
      const obj = objSnapshots.find((o) => o.id === id);
      if (obj) {
        const spec = getObjectType(obj.type);
        if (spec?.resizable) return true;
      }
    }
    return false;
  }, [selection.ids, objSnapshots]);

  // Marquee event handlers
  const handleMarqueeBegin = useCallback(
    (point: Point) => marquee.begin(point),
    [marquee],
  );
  const handleMarqueeMove = useCallback(
    (point: Point) => marquee.move(point),
    [marquee],
  );
  const handleMarqueeEnd = useCallback(() => marquee.end(), [marquee]);
  const handleMarqueeCancel = useCallback(() => marquee.cancel(), [marquee]);

  /** Separate sticky notes and text objects for rendering. */
  const paintedNotes: StickySnapshot[] = useMemo(() => [...notes].sort(byId), [notes]);

  const textObjects: TextSnapshot[] = useMemo(() => {
    const result: TextSnapshot[] = [];
    const objects = doc.getMap('objects');
    for (const [id, entry] of objects) {
      if (entry instanceof (entry as any).constructor) {
        // Check type field
        const type = (entry as any).get?.('type');
        if (type === 'text') {
          const snap = objSnapshots.find((o) => o.id === id);
          if (snap) {
            const textVal = (entry as any).get?.('text');
            const size = (entry as any).get?.('size') ?? 'M';
            const widthMode = (entry as any).get?.('widthMode') ?? 'auto';
            result.push({
              ...snap,
              type: 'text',
              text: textVal?.toString?.() ?? '',
              size,
              widthMode,
            });
          }
        }
      }
    }
    return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }, [objSnapshots, doc, notes]);

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cameraApi}
        onEmptyClick={() => selection.clear()}
        onEmptyDblClick={createAtScreenPoint}
        onMarqueeBegin={handleMarqueeBegin}
        onMarqueeMove={handleMarqueeMove}
        onMarqueeEnd={handleMarqueeEnd}
        onMarqueeCancel={handleMarqueeCancel}
        tool={tool}
        onTextToolClick={handleTextToolClick}
      >
        {paintedNotes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={note.id === selection.editingId}
            onPointerDown={gesture.onObjectPointerDown}
            onSelect={selection.toggle}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
            multiSelected={selection.ids.size > 1}
            dragging={gesture.isDragging && selection.ids.has(note.id)}
            undoBoundary={undoBoundary}
            undoCtrl={undoCtrlRef}
          />
        ))}
        {textObjects.map((tobj) => (
          <TextObject
            key={tobj.id}
            note={tobj}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(tobj.id)}
            editing={tobj.id === selection.editingId}
            canEdit={editing}
            onPointerDown={gesture.onObjectPointerDown}
            onSelect={selection.toggle}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
            multiSelected={selection.ids.size > 1}
            dragging={gesture.isDragging && selection.ids.has(tobj.id)}
            undoBoundary={undoBoundary}
            undoCtrl={undoCtrlRef}
            measure={measure}
          />
        ))}
        <SelectionOverlay
          ids={selection.ids}
          snapshot={objSnapshots}
          camera={camera}
          onHandlePointerDown={gesture.onHandlePointerDown}
          resizable={anyResizable}
        />
        <MarqueeRect rect={marquee.rect} />
      </BoardViewport>
      <Toolbar
        onCreateSticky={createAtCentre}
        disabled={!editing}
        undo={undoApi}
        tool={tool}
        onToolChange={setTool}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cameraApi.zoomStep('in')}
        onZoomOut={() => cameraApi.zoomStep('out')}
        onReset={cameraApi.reset}
      />
      <NavigationHint visible={!hasNavigated && notes.length === 0} />
      <SharePanel boardId={boardId} />
      {/* Selection bar renders in a fixed position overlay */}
      <div className="selection-bar-overlay" data-testid="selection-bar-overlay">
        <SelectionBar
          ids={selection.ids}
          snapshot={notes}
          onDelete={handleDeleteSelection}
          onColor={handleColor}
          editingId={selection.editingId}
          isDragging={gesture.isDragging}
        />
      </div>
    </>
  );
}

/** A stable order for rendered notes: by id, so raising one moves nothing. */
function byId(a: StickySnapshot, b: StickySnapshot): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
