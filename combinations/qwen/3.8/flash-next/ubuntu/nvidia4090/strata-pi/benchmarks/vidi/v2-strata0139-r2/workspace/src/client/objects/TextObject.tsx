import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { objectBounds } from "../../shared/board-model";
import {
  DEFAULT_TEXT_SIZE,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
} from "../../shared/config";
import { deleteIfEmpty, getTextContent, isEmptyText, type TextSnapshot } from "../../shared/objects/text";
import { fontSizeOf } from "./textLayout";
import { useTextBoxSync } from "./useTextBoxSync";
import { TextEditor } from "./TextEditor";
import { useUndoBoundary, useUndoController } from "../board/useUndo";
import type { ObjectProps } from "./registry";

/**
 * One text object (`text.object`).
 *
 * Plain text on the board at x/y: no fill, no border, no box drawn around it —
 * only what the selection overlay puts on it while it is selected. Its width
 * follows its content until somebody drags a side handle; its height always
 * follows its content, which is why the registry gives it horizontal handles
 * only.
 *
 * The gestures are not here: pressing this object hands the pointer to
 * `useTransformGesture`, exactly like a sticky note, and the measuring lives in
 * `useTextBoxSync`. What is here is the rendering, the editor and the rule that
 * an empty text object is not left on the board.
 */
export function TextObject({
  object,
  doc,
  selected,
  editing,
  dragging,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: ObjectProps) {
  const id = object.id;
  const text = object as TextSnapshot;
  const box = objectBounds(object);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const undoBoundary = useUndoBoundary();
  const undo = useUndoController();

  // Measuring this object's text, and remeasuring whenever *this* client changed
  // it (a keystroke, a size change, a dragged handle). A remote client never
  // writes a box: it draws the box the other one measured.
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, id);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The gesture decides whether this press selects, adds to a selection or
    // moves one. It is the same call a sticky note makes.
    onObjectPointerDown(event, id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // A double-click on a text object edits it; it must not create anything.
    event.stopPropagation();
    event.preventDefault();
    onStartEdit(id);
  };

  // A pointerdown anywhere outside the object ends editing — including one on
  // empty board space, which also clears the selection.
  useEffect(() => {
    if (!editing) return;
    const onOutsidePointerDown = (event: PointerEvent) => {
      const el = rootRef.current;
      if (el && event.target instanceof Node && el.contains(event.target)) return;
      onEndEdit("unselected");
    };
    document.addEventListener("pointerdown", onOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", onOutsidePointerDown);
  }, [editing, onEndEdit]);

  // An empty text object is not left lying on the board: leaving editing with
  // nothing in it removes it (and the selection follows the removal).
  const endEdit = useCallback(
    (next: "selected" | "unselected") => {
      if (isEmptyText(doc, id)) {
        undoBoundary();
        deleteIfEmpty(doc, id);
        undoBoundary();
        onEndEdit("unselected");
        return;
      }
      onEndEdit(next);
    },
    [doc, id, onEndEdit, undoBoundary],
  );

  const ytext = editing ? getTextContent(doc, id) : undefined;
  const fontPx = fontSizeOf(text.size ?? DEFAULT_TEXT_SIZE);

  return (
    <div
      ref={rootRef}
      className="text-object"
      data-testid="text-object"
      data-object-type="text"
      data-note-id={id}
      data-selected={selected ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      data-width-mode={text.widthMode ?? "auto"}
      role="group"
      aria-label="Text"
      tabIndex={0}
      style={{
        left: `${round(box.x)}px`,
        top: `${round(box.y)}px`,
        width: `${round(box.width)}px`,
        height: `${round(box.height)}px`,
        fontSize: `${fontPx}px`,
        fontFamily: TEXT_FONT_FAMILY,
        zIndex: text.z,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={box.width}
          onInput={remeasureAfterLocalChange}
          onEnd={endEdit}
          undo={undo}
          className="text-object-text text-object-editor"
          testId="text-object-input"
          ariaLabel="Text"
        />
      ) : (
        <div
          className="text-object-text"
          data-testid="text-object-text"
          style={{ lineHeight: TEXT_LINE_HEIGHT }}
        >
          {text.text ?? ""}
        </div>
      )}
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
