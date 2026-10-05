import { useContext, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { STICKY_SIZE_WORLD, STICKY_COLORS } from '../../shared/config';
import { getStickyText } from '../../shared/board-model';
import { ToolContext } from '../board/useTool';
import { fitFontSize, STICKY_TEXT_PADDING } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

const SELECTION_OUTLINE = '2px solid #1A73E8';

/**
 * One sticky note in the world layer (story 2, resized in story 7). Renders
 * its persisted width/height (STICKY_SIZE_WORLD fallback for pre-story-7
 * notes) and delegates all pointer interaction to the generic transform
 * gesture (useTransformGesture) — selection, group move and resizing are
 * shared by every object type (sel.all_types). Text editing (dblclick /
 * Enter) is unchanged.
 */
export function StickyNote(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, editing, dragging, onObjectPointerDown, onStartEdit, onEndEdit, undo } =
    props;
  // Story 9: in the text tool every object is pointer-transparent so a click
  // anywhere (even over a note) creates text at the click point.
  const tool = useContext(ToolContext);
  const textRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(24);
  const [overflow, setOverflow] = useState(false);

  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;
  const textBox = width - STICKY_TEXT_PADDING * 2;

  // Auto-fit the display text on mount and on text change only (zoom scales
  // uniformly, so no refit is needed on zoom).
  useEffect(() => {
    if (editing) return;
    const el = textRef.current;
    if (!el) return;
    const fit = fitFontSize(el, textBox);
    setFontPx(fit.fontPx);
    setOverflow(fit.overflow);
  }, [obj.text, editing, textBox]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing) return; // the textarea handles pointers while editing
    e.stopPropagation(); // dragging a note never pans the board
    e.preventDefault();
    onObjectPointerDown(e, obj.id);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation(); // a double-click on a note edits it, never creates
    if (editing) return;
    onStartEdit(obj.id);
  };

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-note-id={obj.id}
      data-selected={selected}
      data-dragging={dragging || undefined}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        background: STICKY_COLORS[obj.color ?? 'yellow'],
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        outline: selected ? SELECTION_OUTLINE : 'none',
        outlineOffset: 2,
        cursor: editing ? 'text' : dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
        boxSizing: 'border-box',
        pointerEvents: tool === 'text' ? 'none' : 'auto',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {editing ? (
        <StickyTextEditor ytext={getStickyText(doc, obj.id)!} fontPx={fontPx} onEnd={onEndEdit} undo={undo} />
      ) : (
        <div
          ref={textRef}
          data-testid="sticky-text"
          className={overflow ? 'sticky-text sticky-fade' : 'sticky-text'}
          style={{
            position: 'absolute',
            inset: 0,
            padding: STICKY_TEXT_PADDING,
            boxSizing: 'border-box',
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
            display: 'flex',
            alignItems: overflow ? 'flex-start' : 'center',
            justifyContent: 'center',
            textAlign: 'center',
            color: '#222',
            fontFamily: 'system-ui, sans-serif',
            fontSize: fontPx,
            lineHeight: 1.2,
            pointerEvents: 'none',
          }}
        >
          {obj.text}
        </div>
      )}

      {overflow && !editing && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 48,
            background: `linear-gradient(to bottom, transparent, ${STICKY_COLORS[obj.color ?? 'yellow']})`,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
