import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import * as Y from 'yjs';
import {
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from '@/shared/config';

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
import { getStickyText, type StickySnapshot } from '@/shared/board-model';
import { NOTE_PADDING, fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Current camera zoom (screen px per world unit). */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * Story 4: false while the board failed to load. Selection stays possible
   * but drag, edit-start and the note toolbar (colour/delete) are blocked.
   */
  editable: boolean;
  /** Story 7: true while a group drag involving this note is active. */
  dragging: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /**
   * Story 7: pointerdown is delegated to the board's transform gesture
   * (select / shift-toggle / group move). The note no longer drags itself.
   */
  onObjectPointerDown(e: ReactPointerEvent<HTMLDivElement>): void;
}

const SELECTION_OUTLINE = '#1A73E8';

/**
 * A sticky note on the board (story 2, multi-object selection story 7).
 * Renders the note in the world layer at world (x, y) with its stored
 * width/height (falling back to STICKY_SIZE_WORLD for pre-story-7 notes);
 * handles select/edit start/end. Move, resize and delete of (groups of)
 * notes are owned by the board's transform gesture and keyboard commands.
 *
 * Interaction states (per note, never stored in the doc):
 *   Unselected -> Pressed (pointerdown) -> Selected (up within threshold)
 *   Pressed -> Dragging (board gesture) -> Selected (up/cancel)
 *   Selected -> Editing (dblclick or Enter) -> Selected (Escape)
 *   Editing -> Unselected (click outside)
 */
export function StickyNote(props: StickyNoteProps): ReactElement {
  const { note, doc, selected, editing, editable, dragging, onStartEdit, onEndEdit, onObjectPointerDown } = props;

  const rootRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [font, setFont] = useState(() => ({ fontPx: STICKY_FONT_MAX_PX, overflow: false }));

  const width = note.width !== undefined && Number.isFinite(note.width) ? note.width : STICKY_SIZE_WORLD;
  const height = note.height !== undefined && Number.isFinite(note.height) ? note.height : STICKY_SIZE_WORLD;
  const textBox = Math.max(width - 2 * NOTE_PADDING, 1);

  const colorName: StickyColor = Object.prototype.hasOwnProperty.call(STICKY_COLORS, note.color)
    ? (note.color as StickyColor)
    : DEFAULT_STICKY_COLOR;
  const background = STICKY_COLORS[colorName];

  // Font fit: binary search on the hidden mirror (zoom scales world units
  // uniformly, so no re-fit on zoom). The fit forces a reflow, and a reflow
  // is O(boards notes) — so fitting every note on mount is O(n²) and makes a
  // large board's first paint stall for seconds (story 4, persist.large_board).
  // So the FIRST fit (on mount) is deferred until the note is (near) in the
  // viewport, which bounds an initial load to the visible slice. A re-fit on
  // text change is a single note (O(1)) and stays synchronous, matching the
  // pre-change behaviour editors depend on. Non-browser envs (jsdom) fit now.
  const prevTextRef = useRef(note.text);
  useEffect(() => {
    const mirror = mirrorRef.current;
    const root = rootRef.current;
    if (!mirror || !root) return;
    const textChanged = prevTextRef.current !== note.text;
    prevTextRef.current = note.text;
    const doFit = () => setFont(fitFontSize(mirror, textBox));
    if (textChanged || typeof IntersectionObserver === 'undefined') {
      doFit();
      return;
    }
    // First fit: defer until the note is (near) on screen.
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (cancelled) return;
        for (const e of entries) {
          if (e.isIntersecting) {
            doFit();
            io.disconnect();
            return;
          }
        }
      },
      // A little before the note is on screen so scrolling never flashes an
      // un-fitted size.
      { rootMargin: '256px 0px' },
    );
    io.observe(root);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [note.text, textBox]);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // The board must not pan when a press starts on a note (sticky.no_pan);
      // the gesture stops propagation and drives select/toggle/move from here.
      onObjectPointerDown(e);
    },
    [onObjectPointerDown],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // The viewport must not create a new note when a note is double-clicked.
      e.stopPropagation();
      if (!editing && editable) onStartEdit(note.id);
    },
    [editing, editable, note.id, onStartEdit],
  );

  const ytext = getStickyText(doc, note.id);

  return (
    <div
      ref={rootRef}
      data-testid="sticky-note"
      data-id={note.id}
      data-selected={selected ? true : undefined}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width,
        height,
        // Stacking via z-index (not DOM order) so bringToFront re-renders
        // without moving the node, which would drop pointer capture mid-drag.
        zIndex: note.z,
        background,
        borderRadius: 6,
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.18)',
        outline: selected ? `2px solid ${SELECTION_OUTLINE}` : 'none',
        outlineOffset: 2,
        cursor: !editable ? 'default' : dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        fontFamily: 'Arial, Helvetica, sans-serif',
        userSelect: 'none',
        boxSizing: 'border-box',
      }}
    >
      {/* Hidden mirror used for font measurement (same width/font as display text). */}
      <div
        ref={mirrorRef}
        data-testid="sticky-note-mirror"
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: NOTE_PADDING,
          left: NOTE_PADDING,
          width: textBox,
          height: Math.max(height - 2 * NOTE_PADDING, 1),
          visibility: 'hidden',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: 1.25,
          pointerEvents: 'none',
        }}
      >
        {note.text}
      </div>

      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={font.fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          data-testid="sticky-note-text"
          className={font.overflow ? 'sticky-note-text sticky-note-text--fade' : 'sticky-note-text'}
          style={{
            position: 'absolute',
            top: NOTE_PADDING,
            left: NOTE_PADDING,
            right: NOTE_PADDING,
            bottom: NOTE_PADDING,
            display: 'flex',
            justifyContent: 'center',
            alignItems: font.overflow ? 'flex-start' : 'center',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: '100%',
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: `${font.fontPx}px`,
              lineHeight: 1.25,
              color: 'rgba(0, 0, 0, 0.8)',
            }}
          >
            {note.text}
          </div>
        </div>
      )}

      {/* Bottom fade when the text no longer fits at the minimum size. */}
      {font.overflow && !editing && (
        <div
          data-testid="sticky-note-fade"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 24,
            borderRadius: '0 0 6px 6px',
            background: `linear-gradient(to bottom, ${hexToRgba(background, 0)}, ${background})`,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
