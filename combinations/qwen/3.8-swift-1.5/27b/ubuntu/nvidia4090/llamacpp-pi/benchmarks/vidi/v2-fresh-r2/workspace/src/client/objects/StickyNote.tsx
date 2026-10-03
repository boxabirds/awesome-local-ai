/**
 * Sticky note component (story 2, multi-select story 7).
 *
 * Renders a sticky note at its persisted x/y/width/height (falling back to
 * STICKY_SIZE_WORLD for notes created before story 7) and delegates all
 * pointer interaction to the generic transform gesture (story 7) via
 * `onObjectPointerDown`. Selection outlines, handles and toolbars are drawn
 * by the board-level SelectionOverlay/SelectionBar.
 */

import { useRef, useCallback, useState, useEffect } from 'react';
import type { JSX } from 'react';
import { getStickyText } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_COLORS } from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

/** Padding for text area in the note (world units). */
const PADDING = 16;

export function StickyNote(props: ObjectProps): JSX.Element {
  const { obj, doc, zoom, selected, editing, onObjectPointerDown, onStartEdit, onEndEdit, undo } = props;
  const note = obj as StickySnapshot;
  const width = note.width ?? STICKY_SIZE_WORLD;
  const height = note.height ?? STICKY_SIZE_WORLD;

  const ref = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(24);
  const [overflow, setOverflow] = useState(false);

  // The text box follows the (possibly resized) note size.
  const textBoxHeight = height - PADDING * 2;

  // Fit font when text changes, the size changes, or when switching to
  // display mode.
  useEffect(() => {
    if (editing) return; // Only fit in display mode
    const el = ref.current?.querySelector('[data-sticky-display]') as HTMLElement | null;
    if (!el) return;
    const result = fitFontSize(el, textBoxHeight);
    setFontPx(result.fontPx);
    setOverflow(result.overflow);
  }, [note.text, note.id, editing, width, height, textBoxHeight]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // Prevent board panning
      if (editing) return; // Don't start a gesture while editing
      onObjectPointerDown(e, note.id);
    },
    [editing, note.id, onObjectPointerDown],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (!editing) {
        onStartEdit(note.id);
      }
    },
    [note.id, editing, onStartEdit],
  );

  const color = STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow;

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Sticky note"
      data-selected={selected || undefined}
      data-testid="sticky-note"
      data-note-id={note.id}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width,
        height,
        backgroundColor: color,
        borderRadius: 2,
        boxShadow: selected
          ? '0 0 0 2px #1a73e8, 0 2px 8px rgba(0,0,0,0.15)'
          : '0 2px 8px rgba(0,0,0,0.15)',
        cursor: editing ? 'text' : 'grab',
        outline: 'none',
        touchAction: 'none',
        pointerEvents: 'auto',
      }}
    >
      {editing ? (
        <StickyTextEditor
          ytext={getStickyText(doc, note.id)!}
          fontPx={fontPx}
          boxWidth={width - PADDING * 2}
          boxHeight={height - PADDING * 2}
          onEnd={onEndEdit}
          undo={undo}
        />
      ) : (
        <>
          <div
            data-sticky-display
            style={{
              position: 'absolute',
              inset: PADDING,
              overflow: 'hidden',
              fontSize: `${fontPx}px`,
              lineHeight: 1.3,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: '#333',
              pointerEvents: 'none',
              textAlign: 'center',
            }}
          >
            {note.text}
          </div>
          {overflow && (
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 32,
                background: `linear-gradient(to bottom, transparent, ${color})`,
                pointerEvents: 'none',
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
