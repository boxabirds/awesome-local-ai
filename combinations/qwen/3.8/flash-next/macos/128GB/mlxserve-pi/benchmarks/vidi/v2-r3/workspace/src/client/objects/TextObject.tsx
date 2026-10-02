import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import { type TextSnapshot } from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
} from '../../shared/config';
import { getTextContent, deleteIfEmpty } from '../../shared/objects/text';
import type { EndEditNext } from '../board/useSelection';
import type { UndoController } from '../board/undo';
import { createCanvasMeasurer, type Measurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';

export interface TextObjectProps {
  /** The object as stored in the document: place, box, size, width mode, text. */
  obj: TextSnapshot;
  doc: Y.Doc;
  /** Camera zoom. A text object has nothing of its own to keep the same size on
   * screen at every zoom — the words scale with the board, as they should — but
   * the board passes it to every object alike. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False only while the board cannot be edited. */
  canEdit?: boolean;
  onSelect(id: string): void;
  /** Shift+click toggles the object in/out of the selection. */
  onToggle?(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
  /** Transform gesture handlers: called for pointer events on this object. */
  onGesturePointerDown?(e: ReactPointerEvent<HTMLDivElement>, id: string): void;
  onGesturePointerMove?(e: ReactPointerEvent<HTMLDivElement>): void;
  onGesturePointerUp?(e: ReactPointerEvent<HTMLDivElement>): void;
  onGesturePointerCancel?(e: ReactPointerEvent<HTMLDivElement>): void;
  /** This person's own undo history, handed to the editor and the toolbar. */
  undo?: UndoController;
}

/**
 * One free text object: a rectangle of text and nothing else — no frame, no
 * fill, no corner, no shadow — that can be selected, dragged, resized in width,
 * typed into and deleted (design section 5.2).
 *
 * The box is the one number the document stores for layout: its height is how
 * many lines the text takes at this font size and width, so the text is the
 * source of truth and the box follows it. The drag gesture is delegated to the
 * transform gesture (story 7), exactly as a sticky note delegates it; this
 * component only handles selection, editing, size, width mode and deletion.
 */
export function TextObject(props: TextObjectProps): JSX.Element {
  const { obj, doc, selected, editing } = props;
  const propsRef = useRef(props);
  const ref = useRef<HTMLDivElement>(null);
  const [pressed, setPressed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const gestureActiveRef = useRef(false);
  const startXYRef = useRef<{ x: number; y: number } | null>(null);

  // One measurer per mounted object: the function identity is what the box sync
  // is keyed on, and a new one every render would be pointless work.
  const measureRef = useRef<Measurer | null>(null);
  if (measureRef.current === null) measureRef.current = createCanvasMeasurer();
  const measure = measureRef.current;

  useLayoutEffect(() => {
    propsRef.current = props;
  });

  // The box is written by the client that changed the text, and by nobody else.
  // Somebody else's change is rendered from the box that arrived with it.
  const { remeasureAfterLocalChange: remeasure } = useTextBoxSync(doc, obj.id, measure);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (propsRef.current.editing) {
      // Typing/caret placement inside the object's own textarea.
      e.stopPropagation();
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A press on an object is never a pan: the viewport must not see it.
    e.stopPropagation();
    // Shift+click toggles selection without starting a drag.
    if (e.shiftKey) {
      if (propsRef.current.onToggle) propsRef.current.onToggle(obj.id);
      return;
    }

    setPressed(true);
    gestureActiveRef.current = true;
    startXYRef.current = { x: e.clientX, y: e.clientY };
    if (propsRef.current.onGesturePointerDown) {
      propsRef.current.onGesturePointerDown(e, obj.id);
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!gestureActiveRef.current) return;
    e.stopPropagation();
    if (propsRef.current.onGesturePointerMove) {
      propsRef.current.onGesturePointerMove(e);
    }
    if (!dragging && startXYRef.current !== null) {
      const dx = e.clientX - startXYRef.current.x;
      const dy = e.clientY - startXYRef.current.y;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) setDragging(true);
    }
  };

  const endPress = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!gestureActiveRef.current) return;
    e.stopPropagation();
    gestureActiveRef.current = false;
    setPressed(false);
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (e.type === 'pointerup' && propsRef.current.onGesturePointerUp) {
      propsRef.current.onGesturePointerUp(e);
    } else if (e.type !== 'pointerup' && propsRef.current.onGesturePointerCancel) {
      propsRef.current.onGesturePointerCancel(e);
    }
    // Select the object on click (not drag).
    propsRef.current.onSelect(obj.id);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    // Editing this object; the viewport must not create another one here.
    e.stopPropagation();
    if (propsRef.current.canEdit === false) return;
    propsRef.current.onStartEdit(obj.id);
  };

  /**
   * Editing is over. A text object left with no characters in it is not kept —
   * an empty one is a mistake rather than a thing on the board — and this is the
   * half of the story the model cannot decide on its own, because it only knows
   * when a person stopped editing.
   */
  const endEdit = useCallback((next: EndEditNext) => {
    const current = propsRef.current;
    if (current.canEdit !== false) deleteIfEmpty(current.doc, current.obj.id);
    current.onEndEdit(next);
  }, []);

  const ytext = getTextContent(doc, obj.id);
  const fontPx = TEXT_SIZES[obj.size] ?? TEXT_SIZES.M;
  const state = editing
    ? 'editing'
    : dragging
      ? 'dragging'
      : pressed
        ? 'pressed'
        : selected
          ? 'selected'
          : 'unselected';

  const style = {
    left: `${obj.x}px`,
    top: `${obj.y}px`,
    width: `${obj.width}px`,
    // The stored height is the line count times the line height; `minHeight`
    // rather than `height` because the text is the source of truth: if a real
    // font wraps one line more than the measurement did, the text is shown in
    // full rather than clipped.
    minHeight: `${obj.height}px`,
    fontSize: `${fontPx}px`,
    // The font the box was measured with, written here rather than left to a
    // stylesheet: the measurer asks this family and the browser lays the text out
    // in whatever the page's inherited family happens to be, and if the two
    // differ the text wraps somewhere else than the width was counted for.
    fontFamily: TEXT_FONT_FAMILY,
    lineHeight: String(TEXT_LINE_HEIGHT),
    zIndex: obj.z,
  } as CSSProperties;

  return (
    <div
      ref={ref}
      className={`text-object${editing ? ' is-editing' : ''}`}
      data-text-id={obj.id}
      data-size={obj.size}
      data-mode={obj.widthMode}
      data-selected={selected ? 'true' : 'false'}
      data-state={state}
      data-text-length={obj.text.length}
      data-testid="text-object"
      role="group"
      aria-label="Text"
      tabIndex={0}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onLostPointerCapture={endPress}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="text-display"
        data-testid="text-display"
        aria-hidden={editing ? 'true' : undefined}
      >
        {obj.text}
      </div>
      {editing && ytext !== undefined ? (
        <TextEditor
          ytext={ytext}
          id={obj.id}
          fontPx={fontPx}
          remeasure={remeasure}
          undo={props.undo}
          onEnd={(next) => {
            endEdit(next);
          }}
        />
      ) : null}
    </div>
  );
}
