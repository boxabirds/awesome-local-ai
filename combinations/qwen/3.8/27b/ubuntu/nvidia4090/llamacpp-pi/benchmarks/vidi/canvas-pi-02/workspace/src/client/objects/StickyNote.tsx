import { memo, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as Y from 'yjs';
import { getStickyText } from '../../shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import { scheduleFontFit } from './StickyText';
import type { FontFit } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

const stopEvent = (e: { stopPropagation(): void }): void => {
  e.stopPropagation();
};

/**
 * One sticky note in the world layer (story 2, generalised in story 7).
 *
 * Story 7 changes:
 *  - its own drag state is gone: a pointerdown is delegated to the
 *    window-level transform gesture (`onObjectPointerDown`), which selects,
 *    moves the whole selection and keeps absolute writes;
 *  - the note renders its persisted `width`/`height` (STICKY_SIZE_WORLD when
 *    unset) and the font fit measures that width;
 *  - the toolbar moved to the screen-space SelectionBar (single sticky keeps
 *    the story 2 NoteToolbar);
 *  - selection works on locked boards (viewing), the gesture does not write.
 *
 * Double-click (or Enter when selected) starts text editing; the toolbar and
 * the measurement twin stopPropagation so presses on them never hit the note.
 */
export const StickyNote = memo(function StickyNote(props: ObjectProps): React.JSX.Element {
  const { obj, doc, zoom, selected, editing, editable, undo, onObjectPointerDown, onSelect, onStartEdit, onEndEdit } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<FontFit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  const text = obj.text ?? '';
  const color = STICKY_COLORS[obj.color as keyof typeof STICKY_COLORS] ?? STICKY_COLORS[DEFAULT_STICKY_COLOR];
  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;

  // --- font fit: measure the text at the note's content width -------------
  // Deferred off the render path (story 4, persist.large_board): fitting is a
  // forced-layout read. The note's box is its world size (the measure twin is
  // `inset: 0`), so no layout read is needed to know it; the fit settles on a
  // following frame (one frame on a small board — imperceptible).
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    let cancelled = false;
    scheduleFontFit(el, width, (f) => {
      if (!cancelled) setFit(f);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, editing, width, height]);

  // While editing, a pointerdown anywhere outside the note ends editing
  // (unselected). Capture phase on window: runs before focus moves.
  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (e: Event): void => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        onEndEdit();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [editing, onEndEdit]);

  // --- pointer: delegated to the transform gesture (story 7) --------------

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.stopPropagation(); // the board must not pan (sticky.no_pan)
    if (editing) return; // the editor owns the pointer
    onObjectPointerDown(e.nativeEvent, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation(); // never create a note under an existing one (TC-35)
    if (!editable) return; // locked board (persist.client_status): no text edit
    if (!editing) onStartEdit(obj.id);
  };

  // --- rendering -----------------------------------------------------------

  const ytext = getStickyText(doc, obj.id);
  const rootClass = [
    'vidi6-sticky',
    selected ? 'vidi6-sticky--selected' : null,
    fit.overflow ? 'vidi6-sticky--overflow' : null,
  ]
    .filter(Boolean)
    .join(' ');
  const rootStyle: CSSProperties & Record<'--sticky-color', string> = {
    left: obj.x,
    top: obj.y,
    width,
    height,
    backgroundColor: color,
    '--sticky-color': color,
  };

  return (
    <div
      ref={rootRef}
      className={rootClass}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-note-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : undefined}
      style={rootStyle}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onFocus={() => {
        // Keyboard (Tab) focus makes the note selectable so Enter can start
        // editing. Mouse-driven focus must NOT re-select: a shift-click
        // toggles the selection off on pointerup, and the click's implicit
        // focus would otherwise immediately select it again.
        const el = rootRef.current;
        if (el !== null && !el.matches(':focus-visible')) return;
        if (!selected && !editing) onSelect(obj.id);
      }}
    >
      {/* Hidden measurement twin: same font, width and wrapping as the display text. */}
      <div ref={measureRef} className="vidi6-sticky__measure" aria-hidden="true">
        {text}
      </div>

      {editing && ytext !== undefined ? (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={() => onEndEdit()} undo={undo} />
      ) : (
        <div
          className="vidi6-sticky__text"
          style={{
            fontSize: `${fit.fontPx}px`,
            alignItems: fit.overflow ? 'flex-start' : 'center',
          }}
        >
          {text}
        </div>
      )}

      {fit.overflow && <div className="vidi6-sticky__fade" aria-hidden="true" />}
    </div>
  );
});
