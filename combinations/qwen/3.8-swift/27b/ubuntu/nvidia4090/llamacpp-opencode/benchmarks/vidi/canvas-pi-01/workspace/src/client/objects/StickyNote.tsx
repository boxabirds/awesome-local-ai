// A sticky note on the board (see spec: sticky.interaction, sel.objects).
//
// Rendered in world space (scales with zoom). Presentational: pointer-down
// delegates to the shared transform gesture (select + move), double-click
// begins text editing (only when editable), and text display auto-fits to
// the note's (resizable) width.

import { memo, useEffect, useRef, useState, type JSX } from 'react';
import { getStickyText } from '../../shared/board-model';
import { STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_SIZE_WORLD } from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

function StickyNoteInner(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, editing, dragging, editable, onObjectPointerDown, onFocusSelect, onStartEdit, onEndEdit } = props;
  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;
  const color = obj.color ?? 'yellow';
  const text = obj.text ?? '';
  const noteRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  // Auto-fit in display mode: on mount and on text/width change (not on zoom).
  useEffect(() => {
    const el = textRef.current;
    if (el === null) return;
    setFit(fitFontSize(el, width));
  }, [text, editing, width]);

  const hex = STICKY_COLORS[color];

  return (
    <div
      ref={noteRef}
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-id={obj.id}
      data-dragging={dragging ? 'true' : 'false'}
      data-selected={selected || undefined}
      tabIndex={0}
      className="sticky-note"
      style={{
        left: obj.x,
        top: obj.y,
        width,
        height,
        backgroundColor: hex,
        ['--sticky-bg' as string]: hex,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => onObjectPointerDown(e, obj.id)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (editable) onStartEdit(obj.id);
      }}
      onFocus={() => {
        // The editor's focusin bubbles here (React onFocus = focusin); never
        // treat editing focus as a fresh selection of the note.
        if (!selected && !editing) onFocusSelect(obj.id);
      }}
    >
      {editing ? (
        <StickyTextEditor ytext={getStickyText(doc, obj.id)!} fontPx={fit.fontPx} onEnd={(next) => onEndEdit(next)} />
      ) : (
        <>
          <div ref={textRef} data-testid="sticky-text" className="sticky-text" style={{ fontSize: fit.fontPx }}>
            {text}
          </div>
          {fit.overflow && (
            <div data-testid="sticky-fade" className="sticky-fade" aria-hidden="true" />
          )}
        </>
      )}
    </div>
  );
}

export const StickyNote = memo(StickyNoteInner);
