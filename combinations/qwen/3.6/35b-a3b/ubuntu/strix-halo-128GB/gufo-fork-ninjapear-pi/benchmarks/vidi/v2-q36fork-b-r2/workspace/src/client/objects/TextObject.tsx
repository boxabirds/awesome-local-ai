import * as React from 'react';
import type { Doc, Text } from 'yjs';
import { TEXT_SIZES, DEFAULT_TEXT_SIZE, TEXT_MAX_CHARS, TEXT_FONT_FAMILY } from '../../shared/config';
import type { ObjectSnapshot } from '../../shared/board-model';
import { registerObjectType, getObjectType } from './registry';
import { TextEditor } from './TextEditor';
import { TextToolbar } from './TextToolbar';
import { useTextBoxSync } from './useTextBoxSync';
import { layoutText, createCanvasMeasurer, type Measurer } from './textLayout';
import type { Camera } from '../canvas/camera';
import type { TextSize } from '../../shared/config';

export interface TextObjectProps {
  obj: ObjectSnapshot;
  zoom: number;
  selected: boolean;
  editing: boolean;
  camera: Camera;
  onSelect?: (id: string) => void;
  onStartEdit?: (id: string) => void;
  onEndEdit?: (next: 'selected' | 'unselected') => void;
  onMove?: (id: string, x: number, y: number) => boolean;
  onBringToFront?: (id: string) => boolean;
  onPointerDown?: (e: PointerEvent, id: string) => void;
  // Story 8: undo controller callbacks
  undo?: () => void;
  redo?: () => void;
}

/** Create a canvas measurer for text rendering. */
let _measurerCache: ReturnType<typeof createCanvasMeasurer> | null = null;
function getMeasurer(): typeof _measurerCache {
  if (!_measurerCache) {
    _measurerCache = createCanvasMeasurer(TEXT_FONT_FAMILY);
  }
  return _measurerCache;
}

export function TextObject(props: TextObjectProps): React.JSX.Element {
  const {
    obj,
    zoom,
    selected,
    editing,
    camera,
    onSelect,
    onStartEdit,
    onEndEdit,
    onBringToFront,
    onPointerDown,
    undo,
    redo,
  } = props;

  const x = obj.x;
  const y = obj.y;
  const w = (obj.width !== undefined && Number.isFinite(obj.width)) ? obj.width : 600;
  const h = (obj.height !== undefined && Number.isFinite(obj.height)) ? obj.height : 26;
  const size = (obj.size as TextSize) || DEFAULT_TEXT_SIZE;
  const fontSize = TEXT_SIZES[size];

  // Get the Y.Text content from the underlying map
  const ytext = React.useRef<Text | null>(null);
  
  // Measure function - cached globally
  const measureFn: Measurer = getMeasurer() || ((_t: string, _fp: number) => _t.length * 10);
  
  const syncResult = useTextBoxSync(
    undefined, // Will receive doc reference via events from BoardApp
    obj.id,
    measureFn,
  );

  // Callback that triggers box recalculation on text input
  const handleInput = React.useCallback(() => {
    syncResult.remeasureAfterLocalChange();
  }, [syncResult]);

  // Double-click to start editing
  const handleDoubleClick = React.useCallback(
    (_e: React.MouseEvent) => {
      _e.stopPropagation();
      if (onStartEdit) onStartEdit(obj.id);
    },
    [obj.id, onStartEdit],
  );

  // Select handler
  const handleClick = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onSelect && !editing) {
        onSelect(obj.id);
      }
    },
    [obj.id, onSelect, editing],
  );

  // Pointer down handler
  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      if (onPointerDown) onPointerDown(e.nativeEvent, obj.id);
    },
    [obj.id, onPointerDown],
  );

  // End edit handler
  const handleEndEdit = React.useCallback(
    (next: 'selected' | 'unselected') => {
      if (onEndEdit) onEndEdit(next);
    },
    [onEndEdit],
  );

  // Size change handler (for TextToolbar)
  const handleSizeChange = React.useCallback(
    (newSize: TextSize) => {
      window.dispatchEvent(new CustomEvent('vidi6:textSize', {
        detail: { id: obj.id, size: newSize }
      }));
    },
    [obj.id],
  );

  // Delete handler (for TextToolbar)
  const handleDelete = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('vidi6:deleteObjects', {
      detail: { ids: [obj.id] }
    }));
  }, [obj.id]);

  // Get current text content for display
  const textContent = React.useMemo(() => {
    return (obj.text as string) || '';
  }, [obj.text]);

  // Render text using stored width/height
  return (
    <div
      className={`text-object${selected ? ' text-object--selected' : ''}${editing ? ' text-object--editing' : ''}`}
      data-selected={selected}
      data-object-id={obj.id}
      role="group"
      aria-label={`Text: ${textContent}`}
      tabIndex={selected ? 0 : -1}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: `${w}px`,
        height: `${h}px`,
        cursor: editing ? 'text' : 'default',
        transformOrigin: '0 0',
        userSelect: editing ? 'text' : 'none',
        overflow: 'hidden',
      }}
    >
      {editing ? (
        <>
          {/* When editing, we need to read the actual Y.Text from the doc.
              This is handled by BoardApp which passes it. For now render a placeholder. */}
          <div
            ref={(el) => {
              if (el && typeof document !== 'undefined') {
                el.focus();
                requestAnimationFrame(() => {
                  el.focus();
                });
              }
            }}
            contentEditable
            suppressContentEditableWarning
            style={{
              position: 'absolute',
              inset: 0,
              padding: '4px 8px',
              fontSize: `${fontSize}px`,
              fontFamily: TEXT_FONT_FAMILY,
              color: '#333',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              lineHeight: '1.3',
              boxSizing: 'border-box',
              outline: 'none',
              border: '1px dashed #999',
            }}
            onBlur={() => handleEndEdit('unselected')}
            onPaste={(e) => {
              e.preventDefault();
              const text = e.clipboardData?.getData('text/plain') || '';
              const maxChars = TEXT_MAX_CHARS;
              const clamped = text.slice(0, maxChars - textContent.length);
              document.execCommand('insertText', false, clamped);
            }}
          >
            {textContent || '\u00A0'}
          </div>
        </>
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            fontSize: `${fontSize}px`,
            fontFamily: TEXT_FONT_FAMILY,
            color: '#333',
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
            lineHeight: '1.3',
            padding: '4px 8px',
            boxSizing: 'border-box',
            overflow: 'hidden',
            textAlign: 'left',
            minHeight: 0,
          }}
        >
          {textContent || '\u00A0'}
        </div>
      )}

      {/* Selection outline */}
      {selected && !editing && (
        <div
          style={{
            position: 'absolute',
            inset: '-2px',
            border: '2px solid #1a73e8',
            pointerEvents: 'none',
          }}
          aria-hidden="true"
        />
      )}

      {/* Text toolbar when exactly one text is selected and not editing */}
      {selected && !editing && (() => {
        // Mark as single text selection for parent
        (window as any).__vidi6SingleSelection = obj.id;
        
        return (
          <div
            style={{
              position: 'absolute',
              top: -42,
              left: `${w / 2}px`,
              zIndex: 101,
            }}
          >
            <TextToolbar
              size={size}
              onSize={handleSizeChange}
              onDelete={handleDelete}
            />
          </div>
        );
      })()}
    </div>
  );
}

// --- Registry registration ---
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: 40, // TEXT_MIN_WIDTH_WORLD
  editableText: true,
  handles: 'horizontal',
  hitTest: (obj: ObjectSnapshot, worldPoint: { x: number; y: number }): boolean => {
    const bounds = {
      x: obj.x,
      y: obj.y,
      width: obj.width ?? 600,
      height: obj.height ?? 26,
    };
    return (
      worldPoint.x >= bounds.x &&
      worldPoint.y >= bounds.y &&
      worldPoint.x <= bounds.x + bounds.width &&
      worldPoint.y <= bounds.y + bounds.height
    );
  },
});
