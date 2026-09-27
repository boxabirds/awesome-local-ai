// Story 2: wires the board together: the Y.Doc (useBoardDoc), the notes,
// selection state, keyboard shortcuts and the fixed UI (toolbar, zoom, hint).
//
// Story 3: the live badge reflects the connection state.
//
// Story 5: App is a route switch (share.pages): `/` is the Home page,
// `/b/<id>` is the Board page (existence check, then this board), anything
// else is the Board-not-found page.
//
// Story 7: objects are rendered through the object-type registry, and the
// selection/transform gestures, marquee, selection overlay/bar and keyboard
// commands are wired here. Selection is set-based (many ids); a screen-space
// overlay holds the marquee rect, the selection outline/handles and the bar.

import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { createSticky, deleteObjects } from '../shared/board-model';
import { createText, deleteIfEmpty, getTextContent, getTextMeta } from '../shared/objects/text';
import type { TextSnapshot } from '../shared/objects/text';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { createUndo, type UndoController } from './board/undo';
import { UndoControllerContext, useUndo } from './board/useUndo';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { MarqueeRect, useMarquee } from './board/Marquee';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import { useCamera, useWindowSize } from './canvas/useCamera';
import { getObjectType } from './objects/registry';
import { layoutText, sharedMeasurer } from './objects/textLayout';
import { setTextBox, setTextWidthFixed } from '../shared/objects/text';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import { useRoute } from './router';
import { useTool } from './board/useTool';
import { getIdentityId } from './identity';
import type { Point } from '../shared/geometry';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App(): JSX.Element {
  const route = useRoute();
  if (route.name === 'home') {
    return <HomePage />;
  }
  if (route.name === 'board') {
    return <BoardPage id={route.id} />;
  }
  return <NotFoundPage />;
}

/** The full board experience for one board id (stories 1–4, 7). */
export function Board(props: { boardId: string }): JSX.Element {
  const viewport = useWindowSize();
  const { camera, hasNavigated, zoomStep, reset } = useCamera(viewport);
  const { doc, objects, connectionState } = useBoardDoc(props.boardId);
  // Editing is locked out only while the board could not be loaded (story 4):
  // create/move/resize/edit/colour/delete are no-ops and the toolbar is
  // disabled. Selection stays available (read-only).
  const editable = canEdit(connectionState);
  const selection = useSelection(objects);

  // Story 9: the per-client tool mode (text.tool_ui). T/Text button activate
  // it (only when editable); V/Escape return to Select.
  const { tool, setTool } = useTool(editable);
  const measure = sharedMeasurer();

  // Story 8: one undo controller per board doc (undo.session_only). It is
  // created in an effect (not during render, StrictMode-safe) and destroyed
  // when the doc goes away, so history never survives a reload, a board
  // switch or a room restart.
  const [undoController, setUndoController] = useState<UndoController | null>(null);
  useEffect(() => {
    const controller = createUndo(doc);
    setUndoController(controller);
    return () => {
      controller.destroy();
      setUndoController(null);
    };
  }, [doc]);
  const undo = useUndo(undoController, editable);

  // The shared transform gesture: group move (object pointerdown) and
  // bounding-box resize (handle pointerdown) for every registered type.
  // Story 8: a step boundary before the first moved frame and after the
  // gesture, so a whole drag/resize is exactly one undo step.
  // Story 9: after every resize frame (and at gesture end) remeasure the
  // heights of the resized text objects at their new widths (text.height,
  // text.fixed_width), and flip a single text dragged by its e/w handle to
  // fixed width (one write per drag, at the end).
  const handleTextResize = useCallback(
    (rects: ReadonlyMap<string, { x: number; y: number; width: number; height: number }>, handle: string, final: boolean): void => {
      // Same predicate as the gesture (key decision 2): fixed-width text
      // always scales its width; auto-width text only when the whole
      // selection is text AND the handle moves a horizontal edge.
      const horizontal = handle.includes('e') || handle.includes('w');
      let allText = rects.size > 0;
      for (const id of rects.keys()) {
        if (getTextMeta(doc, id) === undefined) allText = false;
      }
      for (const [id, rect] of rects) {
        const meta = getTextMeta(doc, id);
        if (meta === undefined) continue; // not a text object
        const scales = meta.widthMode === 'fixed' || (allText && horizontal);
        if (!scales) continue; // repositioned: the box is untouched
        const content = getTextContent(doc, id)?.toString() ?? '';
        // The gesture wrote x/y/width (height stale): wrap at the NEW width
        // and write the box (width + fresh height) in the same capture window.
        const layout = layoutText(content, meta.size, 'fixed', rect.width, measure);
        setTextBox(doc, id, { width: rect.width, height: layout.height });
      }
      // Key decision 2: an e/w drag of a SINGLE text object makes it fixed
      // width. (A mixed group with one text repositions it without scaling,
      // so it must stay auto — hence rects.size, not a text count.)
      if (final && rects.size === 1 && (handle === 'e' || handle === 'w')) {
        const [id, rect] = [...rects.entries()][0] ?? [];
        if (id !== undefined && rect !== undefined && getTextMeta(doc, id) !== undefined) {
          setTextWidthFixed(doc, id, rect.width);
        }
      }
    },
    [doc, measure],
  );

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: () => undoController?.boundary(),
    onGestureEnd: () => undoController?.boundary(),
    onResize: handleTextResize,
  });

  // Shift+drag marquee: add the objects inside the rect to the selection.
  const marquee = useMarquee(camera, objects, (ids) => selection.setMany(ids, true));

  const createAtPoint = (at: { x: number; y: number }): void => {
    if (!editable) return; // load_failed: create is a no-op
    // Story 8: a new note is its own step, and the typing burst that follows
    // in the editor is a separate step (boundary on both sides).
    undoController?.boundary();
    const id = createSticky(doc, at);
    undoController?.boundary();
    if (id !== null) {
      selection.click(id);
      selection.startEdit(id);
    }
  };

  const createAtCenter = (): void => {
    createAtPoint(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  };

  // Window keyboard commands (select all, clear, nudge, delete, edit, undo)
  // plus story 9's tool shortcuts (V/T) and N (sticky at view centre).
  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    undo: undoController,
    tool: { tool, setTool },
    onCreateStickyAtCenter: createAtCenter,
  });

  // Story 9 (text.create): a click while the Text tool is active creates a
  // size M text object with its top-left at the point, starts editing it and
  // returns the tool to Select.
  const createTextAt = useCallback(
    (at: Point): void => {
      if (!editable) return; // text.not_editable
      undoController?.boundary();
      const id = createText(doc, at, getIdentityId());
      undoController?.boundary();
      if (id !== null) {
        selection.click(id);
        selection.startEdit(id);
        setTool('select');
      }
    },
    [editable, doc, undoController, selection, setTool],
  );

  // Story 9 (text.empty_removed): ending an edit of a TEXT object removes it
  // when it has no characters. The TextEditor skipped its end-boundary for
  // empty text, so this removal stays in the last edit's capture window and
  // one undo restores the typed text (design key decision 3).
  const handleTextEndEdit = useCallback(
    (id: string): void => {
      const content = getTextContent(doc, id);
      if (content !== undefined && content.length === 0) {
        deleteIfEmpty(doc, id);
        selection.clear();
        return;
      }
      // Deleted remotely during the edit: the selection prunes the id.
      selection.endEdit(id);
    },
    [doc, selection],
  );

  const deleteSelection = (): void => {
    if (!editable) return;
    const ids = [...selection.ids];
    if (ids.length === 0) return;
    // Story 8: a multi-delete is one step; boundaries keep it separate from
    // the actions around it.
    undoController?.boundary();
    deleteObjects(doc, ids);
    undoController?.boundary();
    selection.clear();
  };

  return (
    <UndoControllerContext.Provider value={undoController}>
    <div className="app-root">
      <BoardViewport
        onCreateStickyAt={createAtPoint}
        onClearSelection={() => selection.clear()}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
        textToolActive={tool === 'text'}
        onTextCreateAt={createTextAt}
      >
        {objects.map((obj) => {
          const spec = getObjectType(obj.type);
          if (spec === undefined) return null; // unknown type: never rendered
          const Comp = spec.Component;
          return (
            <Comp
              key={obj.id}
              obj={obj}
              doc={doc}
              selected={selection.ids.has(obj.id)}
              editing={selection.editingId === obj.id}
              canEdit={editable}
              onPointerDown={(e) => gesture.onObjectPointerDown(e, obj.id)}
              onStartEdit={selection.startEdit}
              onEndEdit={obj.type === 'text' ? handleTextEndEdit : selection.endEdit}
            />
          );
        })}
      </BoardViewport>

      {/* Screen-space overlay above the board: marquee rect, selection
          outline + resize handles, and the floating selection bar. It is
          pointer-events: none except the interactive handles/bar, so pans,
          marquee and object presses still reach the board beneath. */}
      <div className="board-overlay">
        <MarqueeRect rect={marquee.rect} camera={camera} />
        <SelectionOverlay
          ids={selection.ids}
          snapshot={objects}
          camera={camera}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
        <SelectionBar
          ids={selection.ids}
          snapshot={objects}
          camera={camera}
          doc={doc}
          canEdit={editable}
          onDelete={deleteSelection}
        />
      </div>

      <Toolbar
        onCreateSticky={createAtCenter}
        canEdit={editable}
        tool={tool}
        setTool={setTool}
        {...undo}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => {
          if (canZoomIn(camera)) zoomStep('in');
        }}
        onZoomOut={() => {
          if (canZoomOut(camera)) zoomStep('out');
        }}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
      <ConnectionStatus state={connectionState} />
    </div>
    </UndoControllerContext.Provider>
  );
}
