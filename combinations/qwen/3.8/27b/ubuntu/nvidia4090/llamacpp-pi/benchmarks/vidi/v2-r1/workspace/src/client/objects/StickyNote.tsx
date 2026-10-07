// StickyNote (story 2, reworked for story 7): render and edit one sticky
// note. Selection, group move and resize no longer live here — pointerdown
// is delegated to the generic transform gesture (sel.all_types), and the
// note renders its persisted `width`/`height` (falling back to the default
// sticky size) with text fit computed from the width.

import { useLayoutEffect, useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import {
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  STICKY_FONT_MAX_PX,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from '../../shared/config';
import { getStickyText } from '../../shared/board-model';
import { fitFontSize, NOTE_PADDING_PX } from './StickyText';
import { StickyTextEditor, type TextFit } from './StickyTextEditor';
import type { ObjectProps } from './registry';

export type StickyNoteProps = ObjectProps;

export function StickyNote(props: StickyNoteProps): JSX.Element {
  const {
    obj,
    doc,
    selected,
    editing,
    canEdit,
    onPointerDown,
    onStartEdit,
    onEndEdit,
  } = props;

  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;
  // Text fit box follows the note width (story 7: "text fit uses width").
  const textBox = Math.max(1, width - NOTE_PADDING_PX * 2);

  const [fit, setFit] = useState<TextFit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  const displayRef = useRef<HTMLDivElement>(null);

  // Display mode: fit the text into the note (largest size that fits).
  useLayoutEffect(() => {
    if (editing) return;
    const el = displayRef.current;
    if (!el) return;
    const next = fitFontSize(el, textBox);
    setFit((f) => (f.fontPx === next.fontPx && f.overflow === next.overflow ? f : next));
  }, [obj.text, editing, textBox]);

  const colorName: StickyColor =
    typeof obj.color === 'string' && obj.color in STICKY_COLORS
      ? (obj.color as StickyColor)
      : DEFAULT_STICKY_COLOR;
  const color = STICKY_COLORS[colorName];
  const ytext = getStickyText(doc, obj.id);

  const onPointerDownHandler = (e: React.PointerEvent<HTMLDivElement>) => {
    // A note must never pan the board (sticky.no_pan): stop propagation so
    // the viewport's pan/marquee never starts.
    e.stopPropagation();
    if (editing) return; // the textarea owns the pointer while editing
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Ignore: best-effort (jsdom).
      }
    }
    onPointerDown(e, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (editing || !canEdit) return;
    e.stopPropagation();
    onStartEdit(obj.id);
  };

  return (
    <div
      className={
        'sticky-note' +
        (selected ? ' sticky-note--selected' : '') +
        (fit.overflow ? ' sticky-note--overflow' : '')
      }
      style={{
        left: obj.x,
        top: obj.y,
        width,
        height,
        // Visual stacking. DOM order is deliberately independent of z (see
        // BoardPage): moving the node when z changes would drop an active
        // pointer capture and abort an in-flight drag.
        zIndex: obj.z,
        background: color,
      }}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-testid="sticky-note"
      data-id={obj.id}
      {...(selected ? { 'data-selected': true } : {})}
      onPointerDown={onPointerDownHandler}
      onDoubleClick={onDoubleClick}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fit.fontPx}
          textBox={textBox}
          onEnd={onEndEdit}
          onFitChange={setFit}
        />
      ) : (
        <div ref={displayRef} className="sticky-note__text" style={{ fontSize: fit.fontPx }}>
          {obj.text}
        </div>
      )}
      {fit.overflow && <div className="sticky-note__fade" data-testid="sticky-fade" />}
    </div>
  );
}
