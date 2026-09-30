import { useRef, useCallback, useEffect, useState } from 'react';
import { getStickyText, type StickySnapshot } from '@shared/board-model';
import { STICKY_COLORS, STICKY_FONT_MAX_PX } from '@shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

/**
 * Story 7: sticky notes render their (persisted) width/height and delegate
 * pointerdown to the generic transform gesture (`useTransformGesture`) via
 * `onObjectPointerDown`. Story 2's own drag code is gone.
 */
export function StickyNote(props: ObjectProps) {
  const { obj, doc, selected, editing, onObjectPointerDown, onStartEdit, onEndEdit } = props;
  const sticky = obj as StickySnapshot;
  const ref = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  const width = obj.width;
  const height = obj.height;

  // Fit font size when text changes - uses the hidden measurement element
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    el.textContent = sticky.text;
    const { fontPx: fitted, overflow: ovf } = fitFontSize(el, width - 32);
    setFontPx(fitted);
    setOverflow(ovf);
  }, [sticky.text, width]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onObjectPointerDown(e, obj.id);
  }, [onObjectPointerDown, obj.id]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onStartEdit(obj.id);
  }, [obj.id, onStartEdit]);

  const color = STICKY_COLORS[sticky.color] || STICKY_COLORS.yellow;
  const ytext = getStickyText(doc, obj.id);

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-selected={selected ? '' : undefined}
      data-note-id={obj.id}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        backgroundColor: color,
        borderRadius: 4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        outline: selected ? '2px solid #2196F3' : 'none',
        outlineOffset: 2,
        cursor: editing ? 'text' : 'grab',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: obj.z,
      }}
    >
      {/* Hidden measurement element for font fitting - always present */}
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: width - 32,
          height: height - 32,
          padding: 0,
          margin: 0,
          fontSize: `${STICKY_FONT_MAX_PX}px`,
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'hidden',
          visibility: 'hidden',
          pointerEvents: 'none',
        }}
      />
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fontPx}
          onEnd={onEndEdit}
        />
      ) : (
        <div
          data-testid="sticky-text"
          className={overflow ? 'sticky-text-overflow' : ''}
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            fontSize: `${fontPx}px`,
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {sticky.text}
          {overflow && (
            <div
              data-testid="text-fade"
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 32,
                background: `linear-gradient(transparent, ${color})`,
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
