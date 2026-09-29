// A sticky note (story 2's appearance and editing, story 7's selection).
//
// It renders *inside* the zoomed world layer, so (x, y) and the size are world
// units and the world layer's CSS `transform: scale(zoom)` scales them. The text
// size is auto-fit to the note's own box in world units, which is why resizing a
// note refits its text instead of stretching it.
//
// Story 7 removed the note's private drag logic: pointer-down is handed to the
// generic gesture (`useTransformGesture`), which owns selection, the drag
// threshold, group moving and the z raise. A later object type that renders here
// therefore gets multi-select, group move, resize and delete for free.

import { useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  getStickyText,
  isStickyColor,
  objectBounds,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model.ts';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from '../../shared/config.ts';
import { fitFontSize } from './StickyText.ts';
import { StickyTextEditor } from './StickyTextEditor.tsx';
import { NoteToolbar } from './NoteToolbar.tsx';
import type { ObjectProps, ObjectToolbarProps } from './registry.tsx';

const PADDING = 12;
const LINE_HEIGHT = 1.25;

export interface StickyNoteProps extends ObjectProps {}

/**
 * A sticky note: an absolutely positioned box in the world layer at (x, y), the
 * stored size or the historical STICKY_SIZE_WORLD, filled with its colour, text
 * centred and auto-fit, with the selection outline when selected.
 */
export function StickyNote(props: StickyNoteProps) {
  const { obj, doc, selected, editing, onEndEdit } = props;
  const canEdit = props.canEdit ?? true;
  // The generic snapshot's `color` is every type's vocabulary; a sticky reads its own
  // names out of it and falls back to its own default for anything else.
  const color = isStickyColor(obj.color) ? obj.color : DEFAULT_STICKY_COLOR;
  const text = obj.text ?? '';
  const bounds = objectBounds(obj);
  // The text box shrinks with the note, both axes (story 7 resize).
  const innerWidth = Math.max(1, bounds.width - PADDING * 2);
  const innerHeight = Math.max(1, bounds.height - PADDING * 2);

  const measureRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });
  // Recompute the auto-fit font size on mount and whenever the text or the note's
  // box changes (never on zoom: the font is in world units, so the world layer's
  // scale handles it).
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    setFit(fitFontSize(el, innerHeight));
  }, [text, innerWidth, innerHeight]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing) return; // the editor (textarea) owns its own pointer events
    props.onObjectPointerDown(e, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation(); // do not create a new note on the board
    if (!canEdit) return; // editing is locked while the board could not be loaded
    props.onObjectDoubleClick(e, obj.id);
  };

  const ytext = editing ? getStickyText(doc as Y.Doc, obj.id) : undefined;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-selected={selected ? 'true' : 'false'}
      data-note-id={obj.id}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute',
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        boxSizing: 'border-box',
        padding: PADDING,
        background: STICKY_COLORS[color],
        color: '#2c2f36',
        borderRadius: 4,
        boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
        overflow: 'hidden',
        zIndex: obj.z,
        pointerEvents: 'auto',
        cursor: 'grab',
        outline: selected ? '2px solid #2f6fed' : 'none',
        outlineOffset: 1,
        userSelect: 'none',
      }}
    >
      <div
        data-testid="sticky-content"
        style={{
          position: 'absolute',
          inset: PADDING,
          overflow: 'hidden',
        }}
      >
        {editing && ytext ? (
          <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
        ) : (
          <div
            data-testid="sticky-text"
            className="sticky-note__text"
            style={{
              width: '100%',
              height: '100%',
              fontSize: fit.fontPx,
              lineHeight: LINE_HEIGHT,
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'break-word',
              wordBreak: 'break-word',
              boxSizing: 'border-box',
            }}
          >
            {text}
          </div>
        )}
        {fit.overflow ? (
          <div
            data-testid="note-fade"
            className="sticky-note__fade"
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 28,
              pointerEvents: 'none',
              background: `linear-gradient(to bottom, rgba(255,255,255,0), ${STICKY_COLORS[color]})`,
            }}
          />
        ) : null}
      </div>

      {/* Off-screen measurement element for font auto-fit: the note's own inner
          box, so the fit follows the note's size. */}
      <div
        ref={measureRef}
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: innerWidth,
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
          lineHeight: LINE_HEIGHT,
          fontSize: `${fit.fontPx}px`,
          boxSizing: 'border-box',
        }}
      >
        {text}
      </div>
    </div>
  );
}

/**
 * The toolbar of a single selected sticky note (story 2). It lives here, with the
 * type, because the colour of a note is a sticky-note fact: the board shell only
 * knows "the selected object's type has a toolbar" and hands it the document, the
 * edit lock and the generic delete action.
 */
export function StickyNoteToolbar(props: ObjectToolbarProps) {
  const note = props.obj as StickySnapshot;
  const onColor = (color: StickyColor) => {
    if (!props.canEdit) return; // an unloadable board stays exactly as it is
    setStickyColor(props.doc, note.id, color);
  };
  return (
    <NoteToolbar
      color={note.color ?? DEFAULT_STICKY_COLOR}
      onColor={onColor}
      onDelete={() => props.onDelete?.()}
    />
  );
}

// `objects/registry.tsx` registers this component as the 'sticky' type.
export default StickyNote;
