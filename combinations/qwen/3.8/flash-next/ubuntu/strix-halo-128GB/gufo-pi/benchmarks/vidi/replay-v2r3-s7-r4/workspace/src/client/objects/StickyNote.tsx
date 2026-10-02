import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  deleteObject,
  getStickyText,
  setStickyColor,
} from '../../shared/board-model';
import { STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_SIZE_WORLD } from '../../shared/config';
import type { StickyColor } from '../../shared/config';
import { fitFontSize, NOTE_TEXT_INSET } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';
import type { ObjectProps } from './registry';

/**
 * One sticky note, drawn in the world layer at its (x, y) and size. Selecting,
 * dragging, resizing, editing and recolouring are all driven by the generic
 * story 7 machinery (registry props + transform gesture); this component only
 * renders and delegates pointer input through `onObjectPointerDown`.
 */
export function StickyNote({
  obj,
  doc,
  camera,
  selected,
  editing,
  dragging,
  editable,
  isSoleSelected,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: ObjectProps) {
  const textRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);
  const zoom = camera.zoom || 1;

  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;

  // Text auto-fit: the largest size that fits, recomputed when the text changes.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    // Without a layout engine (jsdom) clientHeight is 0, and the size stays at
    // the maximum — all a layout-free test can assert.
    const box = el.clientHeight > 0 ? el.clientHeight : Number.POSITIVE_INFINITY;
    const result = fitFontSize(el, box);
    setFontPx((prev) => (prev === result.fontPx ? prev : result.fontPx));
    setOverflow((prev) => (prev === result.overflow ? prev : result.overflow));
  }, [width, height, obj.text]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // The board must never pan because a press started on a note.
      e.stopPropagation();
      // While editing, a press inside the note belongs to the text caret.
      if (editing) return;
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

  const handleColor = useCallback(
    (color: StickyColor) => {
      if (!editable) return;
      setStickyColor(doc, obj.id, color);
    },
    [doc, obj.id, editable],
  );

  const handleDelete = useCallback(() => {
    if (!editable) return;
    deleteObject(doc, obj.id);
    onEndEdit('unselected');
  }, [doc, obj.id, onEndEdit, editable]);

  const background = STICKY_COLORS[obj.color] ?? STICKY_COLORS.yellow;
  const ytext = editing ? getStickyText(doc, obj.id) : undefined;

  return (
    <div
      data-note-id={obj.id}
      data-testid="sticky-note"
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        backgroundColor: background,
        borderRadius: 4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        outline: selected ? '2px solid #1976D2' : 'none',
        boxSizing: 'border-box',
        cursor: dragging ? 'grabbing' : 'grab',
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
        {obj.text}
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
      {isSoleSelected && !editing && !dragging && (
        <div
          data-testid="note-toolbar-anchor"
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            // Counteracts the world scale so the toolbar keeps a screen-space size.
            transform: `scale(${1 / zoom})`,
            transformOrigin: 'bottom left',
            paddingBottom: 8,
          }}
        >
          <NoteToolbar color={obj.color} onColor={handleColor} onDelete={handleDelete} />
        </div>
      )}
    </div>
  );
}
