/**
 * Sticky note object (story 2), drawn from the generic object props the story 7
 * registry defines.
 *
 * The note still owns everything about *being a sticky note*: its text, its
 * colour, the auto-fit and the note toolbar. What it no longer owns is
 * selection, dragging and resizing: those are the board's shared transform
 * gesture, because a group has to move as one. A press on a note therefore just
 * hands the pointer over.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getStickyText, deleteObjects, objectBounds, setStickyColor } from '../../shared/board-model';
import { STICKY_COLORS, STICKY_FONT_MAX_PX } from '../../shared/config';
import type { StickyColor } from '../../shared/config';
import { fitFontSize, NOTE_TEXT_INSET } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';
import type { ObjectProps } from './registry';

export function StickyNote({
  obj,
  doc,
  zoom,
  selected,
  soleSelected,
  editing,
  transforming,
  editable = true,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: ObjectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  const bounds = objectBounds(obj);
  const text = obj.text ?? '';

  // Text auto-fit: the largest size that fits, recomputed when the text or the
  // note's size changes — a resized note re-fits its text.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    // Without a layout engine (jsdom) clientHeight is 0, and the size stays at
    // the maximum — all a layout-free test can assert.
    const box = el.clientHeight > 0 ? el.clientHeight : Number.POSITIVE_INFINITY;
    const result = fitFontSize(el, box);
    setFontPx((prev) => (prev === result.fontPx ? prev : result.fontPx));
    setOverflow((prev) => (prev === result.overflow ? prev : result.overflow));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, editing, bounds.width, bounds.height]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      // While editing, a press inside the note belongs to the text caret.
      if (editing) return;
      // Selection plus the shared move/resize gesture live in the board, which
      // also stops the press from ever becoming a pan.
      onObjectPointerDown(e, obj.id);
    },
    [editing, onObjectPointerDown, obj.id],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Editing this note, never creating a new one behind it.
      e.stopPropagation();
      if (!editable) return;
      onStartEdit(obj.id);
    },
    [obj.id, onStartEdit, editable],
  );

  // Focus returns to the note when editing ends, so Delete still works.
  useEffect(() => {
    if (selected && !editing) rootRef.current?.focus({ preventScroll: true });
  }, [selected, editing]);

  const handleColor = useCallback(
    (color: StickyColor) => {
      if (!editable) return;
      setStickyColor(doc, obj.id, color);
    },
    [doc, obj.id, editable],
  );

  const handleDelete = useCallback(() => {
    if (!editable) return;
    deleteObjects(doc, [obj.id]);
    onEndEdit('unselected');
  }, [doc, obj.id, onEndEdit, editable]);

  const background = STICKY_COLORS[obj.color ?? 'yellow'] ?? STICKY_COLORS.yellow;
  const ytext = editing ? getStickyText(doc, obj.id) : undefined;

  return (
    <div
      ref={rootRef}
      data-note-id={obj.id}
      data-testid="sticky-note"
      data-selected={selected ? 'true' : 'false'}
      data-dragging={transforming ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: bounds.width,
        height: bounds.height,
        backgroundColor: background,
        borderRadius: 4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        // The story 7 selection overlay draws the outline for every object type.
        boxSizing: 'border-box',
        cursor: transforming ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <div
        ref={textRef}
        data-testid="sticky-note-text"
        className={
          overflow ? 'sticky-note__text sticky-note__text--overflow' : 'sticky-note__text'
        }
        style={{
          position: 'absolute',
          inset: NOTE_TEXT_INSET,
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          textAlign: 'center',
          color: '#1f1f1f',
          fontFamily: 'inherit',
          fontWeight: 500,
          lineHeight: 1.25,
          fontSize: fontPx,
          opacity: editing ? 0 : 1,
          pointerEvents: 'none',
        }}
      >
        {text}
      </div>
      {overflow && !editing && (
        <div
          className="sticky-note__fade"
          data-testid="sticky-note-fade"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: NOTE_TEXT_INSET,
            right: NOTE_TEXT_INSET,
            bottom: NOTE_TEXT_INSET,
            height: Math.max(12, fontPx * 1.25),
            pointerEvents: 'none',
            background: `linear-gradient(to bottom, rgba(255,255,255,0) 0%, ${background} 85%)`,
          }}
        />
      )}
      {editing && ytext && (
        <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} />
      )}
      {/* Story 2's note toolbar: exactly one selected note, not while editing
          or transforming. The selection bar takes over for a group. */}
      {selected && soleSelected && !editing && !transforming && (
        <div
          data-testid="note-toolbar-anchor"
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            // Counteracts the world scale so the toolbar keeps a screen-space size.
            transform: `scale(${1 / (zoom || 1)})`,
            transformOrigin: 'bottom left',
            paddingBottom: 8,
          }}
        >
          <NoteToolbar color={obj.color ?? 'yellow'} onColor={handleColor} onDelete={handleDelete} />
        </div>
      )}
    </div>
  );
}
