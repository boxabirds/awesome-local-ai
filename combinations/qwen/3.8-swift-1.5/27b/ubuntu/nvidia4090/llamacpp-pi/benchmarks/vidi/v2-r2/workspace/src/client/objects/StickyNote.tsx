/**
 * Renders a sticky note in world space (transformed by the viewport world layer).
 * Story 7: the component no longer drags itself — pointer-down is delegated to
 * the shared transform gesture (ObjectProps.onPointerDown), and the selection
 * UI (toolbar) moved to the SelectionBar. It renders at its snapshot
 * width/height (implicit STICKY_SIZE_WORLD until the first resize writes them).
 */
import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { ObjectProps } from './registry';
import type { StickySnapshot } from '../../shared/board-model';
import {
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  STICKY_FONT_MAX_PX,
  type StickyColor,
} from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

const TEXT_PADDING = 16;

export function StickyNote({
  obj,
  doc,
  z,
  selected,
  editing,
  editable = true,
  onPointerDown,
  onStartEdit,
  onEndEdit,
  boundary,
  undoController,
}: ObjectProps) {
  const note = obj as StickySnapshot;
  const noteElRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  const width = note.width ?? STICKY_SIZE_WORLD;
  const height = note.height ?? STICKY_SIZE_WORLD;
  const background = STICKY_COLORS[note.color] ?? STICKY_COLORS[DEFAULT_FALLBACK];

  // Fit the font to the box; flag overflow when the text no longer fits.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    setFit(fitFontSize(el, width - 2 * TEXT_PADDING));
  }, [note.text, editing, width]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    // Delegate: the gesture stops propagation (so the viewport doesn't pan),
    // selects (clicking an unselected object selects it) and starts the move.
    onPointerDown(e, note.id);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (editable) {
      onStartEdit(note.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && editable && !editing) {
      e.preventDefault();
      onStartEdit(note.id);
    }
  };

  const ytext = (doc.getMap('objects').get(note.id) as Y.Map<unknown> | undefined)?.get('text') as
    | Y.Text
    | undefined;

  return (
    <div
      ref={noteElRef}
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected || undefined}
      data-editing={editing || undefined}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width,
        height,
        zIndex: z,
        boxSizing: 'border-box',
        background,
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        outline: selected ? '2px solid #2563eb' : 'none',
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} boundary={boundary} undoController={undoController} />
      ) : (
        <>
          <div
            ref={textRef}
            data-testid="sticky-text"
            style={{
              position: 'absolute',
              inset: 0,
              boxSizing: 'border-box',
              padding: TEXT_PADDING,
              overflow: 'hidden',
              display: 'flex',
              alignItems: fit.overflow ? 'flex-start' : 'center',
              justifyContent: 'center',
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: `${fit.fontPx}px`,
              lineHeight: 1.2,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: '#333',
              pointerEvents: 'none',
            }}
          >
            {note.text}
          </div>
          {fit.overflow && (
            <div
              data-testid="sticky-fade"
              className="sticky-fade"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 28,
                background: `linear-gradient(to bottom, rgba(0,0,0,0), ${background})`,
                pointerEvents: 'none',
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

const DEFAULT_FALLBACK: StickyColor = 'yellow';
