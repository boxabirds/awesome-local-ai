import { useEffect, useRef, useState, type JSX } from 'react';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SELECTION_OUTLINE,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_PADDING,
} from '../../shared/config';
import type { StickySnapshot } from '../../shared/board-model';
import { getStickyText } from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import type { ObjectProps } from './registry';
import { StickyTextEditor } from './StickyTextEditor';

const LINE_HEIGHT = 1.2;
const INK_COLOR = '#3c3c34';
const TEXT_FAMILY =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * One sticky note (registered as type "sticky").
 *
 * Story 7: the note no longer drags itself. It renders its (possibly
 * resized) size, reports pointerdown/double-click to the board, and delegates
 * selection, the transform gesture and editing to the board
 * (sel.transform / sel.interaction). Future object types use the same
 * ObjectProps (sel.all_types).
 */
export function StickyNote(props: ObjectProps): JSX.Element {
  const { doc, obj, selected, editingId, onPointerDown, onEdit, onEndEdit, onTextBoundary, onTextUndo } = props;
  const note = obj as StickySnapshot;
  const editing = editingId === obj.id;
  const width = note.width ?? STICKY_SIZE_WORLD;
  const height = note.height ?? STICKY_SIZE_WORLD;

  // ---- display-mode font fitting (runs when text/size changes / edit ends)
  const textRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  useEffect(() => {
    if (editing) {
      return;
    }
    const el = textRef.current;
    if (el === null) {
      return;
    }
    setFit(fitFontSize(el, width - STICKY_TEXT_PADDING * 2));
  }, [note.text, editing, width]);

  const ytext = editing ? (getStickyText(doc, note.id) ?? null) : null;

  return (
    <div
      data-sticky-note={note.id}
      data-object-id={note.id}
      data-testid="sticky-note"
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      onPointerDown={(e) => {
        if (editing) {
          return; // the textarea owns pointer events while editing (caret)
        }
        // Capture the pointer on the note so a group-move gesture keeps its
        // events even when the cursor crosses other objects mid-drag. (JSDOM
        // and some engines lack the API; the window listeners still work.)
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          // ignore: capture is best-effort
        }
        e.stopPropagation();
        onPointerDown(e, obj.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing) {
          onEdit(obj.id);
        }
      }}
      style={{
        position: 'absolute',
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: note.z,
        background: STICKY_COLORS[note.color],
        borderRadius: 4,
        boxShadow: selected
          ? '0 1px 4px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.22)'
          : '0 1px 4px rgba(0,0,0,0.18)',
        outline: selected ? STICKY_SELECTION_OUTLINE : 'none',
        outlineOffset: 2,
        pointerEvents: 'auto',
        cursor: editing ? 'text' : 'grab',
        fontFamily: TEXT_FAMILY,
        boxSizing: 'border-box',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      {editing && ytext !== null ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={STICKY_FONT_MAX_PX}
          onEnd={onEndEdit}
          onBoundary={onTextBoundary}
          onUndo={onTextUndo}
        />
      ) : (
        <>
          <div
            ref={textRef}
            data-testid="sticky-note-text"
            style={{
              position: 'absolute',
              inset: STICKY_TEXT_PADDING,
              overflow: 'hidden',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: `${fit.fontPx}px`,
              lineHeight: String(LINE_HEIGHT),
              color: INK_COLOR,
              pointerEvents: 'none',
            }}
          >
            {note.text}
          </div>
          {fit.overflow && (
            <div
              data-testid="sticky-fade"
              className="sticky-note-fade"
              style={{
                position: 'absolute',
                left: STICKY_TEXT_PADDING,
                right: STICKY_TEXT_PADDING,
                bottom: 0,
                height: 28,
                background: 'linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.22))',
                pointerEvents: 'none',
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
