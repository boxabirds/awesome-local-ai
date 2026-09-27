import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getStickyText, objectBounds } from '../../shared/board-model';
import { STICKY_COLORS, STICKY_FONT_MAX_PX, type StickyColor } from '../../shared/config';
import type { ObjectProps } from './registry';
import { StickyTextEditor } from './StickyTextEditor';
import { fitFontSize } from './StickyText';

const PADDING = 12; // world units of text padding on each side

/**
 * A sticky note, drawn from the generic `ObjectProps` every board object gets
 * (sel.registry).
 *
 * Story 7 removed the note's own drag code: pressing it hands the pointer to the
 * generic transform gesture (`onObjectPointerDown`), which selects, moves and
 * resizes the whole selection identically for every registered type. What stays
 * here is the note's look (colour, auto-fit text, overflow fade) and the
 * double-click that starts editing.
 *
 * The size comes from the object. Notes written before story 7 have no persisted
 * size and render at STICKY_SIZE_WORLD — the same fallback `objectBounds` uses,
 * which is what makes them resizable without a migration.
 */
export function StickyNote({
  obj,
  doc,
  selected,
  editing,
  editable,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: ObjectProps) {
  const bounds = objectBounds(obj);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState<number>(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState<boolean>(false);

  // Recompute the auto-fit font when the text or the note's own box changes. The
  // font is authored in WORLD units, so this is not run on zoom (the world
  // layer's scale() grows it with the board) — see design "Sticky note text
  // editing and fit".
  const boxWidth = Math.max(0, bounds.width - 2 * PADDING);
  const boxHeight = Math.max(0, bounds.height - 2 * PADDING);
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || editing) return;
    const fit = fitFontSize(el, boxHeight);
    setFontPx(fit.fontPx);
    setOverflow(fit.overflow);
  }, [obj.text, editing, boxWidth, boxHeight]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // The board must never pan because of a press on a note.
    e.stopPropagation();
    // No gesture while editing text. A read-only board is NOT filtered here:
    // pressing still selects (selection is view state), and the transform gesture
    // is what refuses to move, resize or delete anything.
    if (editing) return;
    onObjectPointerDown(e, obj.id);
  };

  const onDoubleClick = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editing && editable) onStartEdit?.(obj.id);
  };

  const color = STICKY_COLORS[(obj.color ?? 'yellow') as StickyColor] ?? STICKY_COLORS.yellow;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-note-id={obj.id}
      data-obj-id={obj.id}
      data-obj-type={obj.type}
      data-selected={selected ? 'true' : 'false'}
      data-width={Math.round(bounds.width)}
      data-height={Math.round(bounds.height)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute',
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        backgroundColor: color,
        boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
        pointerEvents: 'auto',
        outline: selected ? '2px solid #2563eb' : 'none',
        outlineOffset: 0,
        // Text is authored in world units; the world layer's zoom scale makes
        // it grow/shrink with the board.
        fontSize: fontPx,
        color: '#111',
      }}
    >
      {editing ? (
        <StickyTextEditor
          key="edit"
          ytext={getStickyText(doc, obj.id)!}
          fontPx={fontPx}
          padding={PADDING}
          onEnd={(next) => onEndEdit?.(next)}
        />
      ) : (
        <div
          ref={contentRef}
          data-testid="sticky-display"
          style={{
            position: 'absolute',
            inset: 0,
            padding: PADDING,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            textAlign: 'center',
            lineHeight: 1.25,
            fontSize: fontPx,
            color: '#111',
          }}
        >
          {obj.text}
        </div>
      )}

      {overflow && (
        <div
          data-testid="sticky-fade"
          className="sticky-overflow"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 28,
            background: 'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.85))',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
