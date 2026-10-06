import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as Y from "yjs";
import { deleteObject, objectBounds, setStickyColor, type StickySnapshot } from "../../shared/board-model";
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_TEXT_BOX_WORLD,
  type StickyColor,
} from "../../shared/config";
import { fitFontSize, textBoxStyle } from "./StickyText";
import { StickyTextEditor } from "./StickyTextEditor";
import { NoteToolbar } from "./NoteToolbar";
import type { ObjectProps } from "./registry";

/**
 * One sticky note: rendered in the world layer at its board position, so it
 * scales with the board zoom.
 *
 * Story 7 moved the *gesture* machinery out of this file: pressing a note hands
 * the pointer over to `useTransformGesture`, which is where moving (one note or
 * a whole selection, with the threshold, the bring-to-front and the per-frame
 * write) lives, and where resizing is decided for every type. What stays here is
 * what is specific to a sticky note — its colour, its text and its auto-fit, the
 * text editor, story 2's note toolbar, and the rules that keep a note's gestures
 * from panning or zooming the board.
 *
 * Interaction state (never stored in the document):
 *   Unselected -> Pressed -> Selected, or Dragging (moved at least
 *   DRAG_THRESHOLD_PX) -> Selected. Editing is entered by a double-click or
 *   Enter. `dragging` and `selected` arrive as props, from the selection and the
 *   gesture.
 *
 * Every pointer event on a note stops propagation, so the viewport neither pans
 * nor clears the selection while a note is used (sticky.no_pan).
 */
export interface StickyNoteProps extends ObjectProps {
  doc: Y.Doc;
}

export function StickyNote({
  object,
  doc,
  zoom,
  selected,
  editing,
  dragging,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps) {
  const id = object.id;
  const note = object as StickySnapshot;
  const box = objectBounds(object);
  // A resized sticky note stays square (its type is aspect-locked); the fit is
  // measured against the size it actually has.
  const textBox = Number.isFinite(box.width) && box.width > 0 ? box.width : STICKY_TEXT_BOX_WORLD;

  const noteRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The gesture itself belongs to `useTransformGesture`: it decides whether
    // this press selects, adds to a selection or moves one.
    onObjectPointerDown(event, id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // A double-click on a note edits it; it must not create another note.
    event.stopPropagation();
    event.preventDefault();
    onStartEdit(id);
  };

  // The toolbar sits inside the viewport's DOM, and the viewport listens for
  // wheel natively (non-passive), i.e. before React sees anything: block those
  // gestures on the toolbar itself so it can never pan or zoom the board.
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const stop = (event: Event) => event.stopPropagation();
    const gestures: Array<[string, AddEventListenerOptions]> = [
      ["wheel", { passive: false }],
      ["pointerdown", {}],
      ["pointerup", {}],
      ["dblclick", {}],
    ];
    for (const [name, options] of gestures) el.addEventListener(name, stop, options);
    return () => {
      for (const [name] of gestures) el.removeEventListener(name, stop);
    };
  }, [selected, editing, dragging]);

  // A pointerdown anywhere outside the note ends editing (sticky.edit_end) —
  // including one on empty board space, which also clears the selection.
  useEffect(() => {
    if (!editing) return;
    const onOutsidePointerDown = (event: PointerEvent) => {
      const el = noteRef.current;
      if (el && event.target instanceof Node && el.contains(event.target)) return;
      onEndEdit("unselected");
    };
    document.addEventListener("pointerdown", onOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", onOutsidePointerDown);
  }, [editing, onEndEdit]);

  // ---- text auto-fit (display mode) --------------------------------------
  useLayoutEffect(() => {
    if (editing) return;
    const el = textRef.current;
    if (!el) return;
    const next = fitFontSize(el, textBox);
    setFit((previous) =>
      previous.fontPx === next.fontPx && previous.overflow === next.overflow ? previous : next,
    );
  }, [editing, note.text, textBox]);

  // ---- rendering -----------------------------------------------------------
  const showToolbar = selected && !editing && !dragging;

  return (
    <div
      ref={noteRef}
      className={`sticky-note${selected ? " is-selected" : ""}`}
      data-testid="sticky-note"
      data-object-type="sticky"
      data-note-id={id}
      data-selected={selected ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      data-overflow={fit.overflow ? "true" : "false"}
      role="group"
      aria-label={`Sticky note, ${note.color}`}
      tabIndex={0}
      style={{
        left: `${round(box.x)}px`,
        top: `${round(box.y)}px`,
        width: `${round(box.width)}px`,
        height: `${round(box.height)}px`,
        background: STICKY_COLORS[note.color],
        // Stacking is the document's z, applied as a CSS z-index. The DOM order
        // stays stable, so a drag is never interrupted by the board re-parenting
        // the note (which would release its pointer capture).
        zIndex: note.z,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {editing ? (
        <StickyTextEditor ytext={textOf(doc, id)} fontPx={fit.fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          ref={textRef}
          className={`sticky-note-text${fit.overflow ? " is-overflow" : ""}`}
          data-testid="sticky-note-text"
          data-overflow={fit.overflow ? "true" : "false"}
          style={textBoxStyle({ fontSize: `${fit.fontPx}px` })}
        >
          {note.text}
        </div>
      )}

      {fit.overflow && !editing ? (
        <div className="sticky-note-fade" data-testid="sticky-note-fade" aria-hidden="true" />
      ) : null}

      {showToolbar ? (
        <div
          ref={anchorRef}
          className="sticky-note-toolbar-anchor"
          data-testid="sticky-note-toolbar-anchor"
          style={{ transform: `scale(${1 / zoomRef.current})` }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(color: StickyColor) => {
              setStickyColor(doc, id, color);
            }}
            onDelete={() => {
              deleteObject(doc, id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function textOf(doc: Y.Doc, id: string): Y.Text {
  const objects = doc.getMap<Y.Map<unknown>>("objects");
  const entry = objects.get(id);
  const text = entry instanceof Y.Map ? entry.get("text") : undefined;
  if (text instanceof Y.Text) return text;
  // Should not happen: the editor is only mounted for a note in the document.
  return new Y.Text();
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
