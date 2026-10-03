// Sticky note component: render + edit.
// Story 7: selection, move and resize are handled by the shared transform
// gesture (useTransformGesture); the note only renders and delegates input.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../shared/config';
import { getStickyText, type ObjectSnapshot } from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

export function StickyNote({
  obj,
  doc,
  zoom,
  selected,
  editing,
  onObjectPointerDown,
  onObjectDoubleClick,
  onEndEdit,
  onBoundary,
  onUndo,
  onRedo,
}: ObjectProps) {
  const [fontPx, setFontPx] = useState(24);
  const [overflow, setOverflow] = useState(false);
  const textElRef = useRef<HTMLDivElement>(null);

  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;
  const color = STICKY_COLORS[obj.color ?? 'yellow'] ?? STICKY_COLORS.yellow;

  // Fit font size when text changes (not while editing). Uses width:
  // resizing the note re-fits the text.
  useEffect(() => {
    if (editing) return;
    const el = textElRef.current;
    if (!el) return;
    const box = width - 32; // padding
    const result = fitFontSize(el, box);
    setFontPx(result.fontPx);
    setOverflow(result.overflow);
  }, [obj.text, editing, width]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation(); // Don't let the viewport pan
    onObjectPointerDown(e, obj.id);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    onObjectDoubleClick(obj.id);
  };

  // Get Y.Text for the editor
  const ytext = editing ? getStickyText(doc, obj.id) : undefined;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-selected={selected || undefined}
      data-editing={editing || undefined}
      tabIndex={0}
      className="sticky-note"
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        backgroundColor: color,
        borderRadius: '4px',
        boxShadow: selected
          ? '0 0 0 2px #1976D2, 0 4px 12px rgba(0,0,0,0.15)'
          : '0 2px 8px rgba(0,0,0,0.12)',
        cursor: 'grab',
        userSelect: 'none',
        touchAction: 'none',
        pointerEvents: 'auto',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {/* Text display (not editing) */}
      {!editing && (
        <div
          className="sticky-note__text-wrapper"
          style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            boxSizing: 'border-box',
          }}
        >
          <div
            ref={textElRef}
            className="sticky-note__text"
            style={{
              fontSize: `${fontPx}px`,
              lineHeight: 1.3,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              textAlign: 'center',
              color: '#333',
              maxWidth: '100%',
            }}
          >
            {obj.text}
          </div>
        </div>
      )}
      {overflow && !editing && (
        <div
          className="sticky-note__fade"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '32px',
            background: `linear-gradient(to bottom, transparent, ${color})`,
            pointerEvents: 'none',
            borderRadius: '0 0 4px 4px',
          }}
        />
      )}

      {/* Text editor (editing mode) */}
      {editing && ytext && (
        <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} onBoundary={onBoundary} onUndo={onUndo} onRedo={onRedo} />
      )}
    </div>
  );
}
