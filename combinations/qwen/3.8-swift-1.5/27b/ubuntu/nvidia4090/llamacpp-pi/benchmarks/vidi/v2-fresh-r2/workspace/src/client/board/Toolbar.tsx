/**
 * Top-center toolbar: Select (V), Text (T), Sticky (N), Shape (S, with a
 * kind menu), Connector (L), Undo/Redo.
 */

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { UseUndoResult } from './useUndo';
import type { ToolId } from './useTool';
import {
  SHAPE_KINDS,
  type ShapeKind,
} from '../../shared/config';

/** Display names for the shape kinds (menu + accessibility). */
const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

interface ToolbarProps {
  tool: ToolId;
  setTool(tool: ToolId): void;
  canEdit: boolean;
  onCreateSticky(): void;
  /** Story 12: open the image picker (I shortcut). */
  onCreateImage?(): void;
  undo: UseUndoResult;
  shapeKind: ShapeKind;
  setShapeKind(kind: ShapeKind): void;
}

export function Toolbar({
  tool,
  setTool,
  canEdit,
  onCreateSticky,
  onCreateImage,
  undo,
  shapeKind,
  setShapeKind,
}: ToolbarProps): JSX.Element {
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the kind menu on outside pointerdown.
  useEffect(() => {
    if (!shapeMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShapeMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [shapeMenuOpen]);

  const toolButtonStyle = (active: boolean, enabled = true): React.CSSProperties => ({
    padding: '6px 10px',
    border: '1px solid transparent',
    borderRadius: 6,
    background: active ? '#e8f0fe' : 'transparent',
    cursor: enabled ? 'pointer' : 'default',
    fontSize: 13,
    opacity: enabled ? 1 : 0.5,
  });

  return (
    <div
      role="toolbar"
      aria-label="Board tools"
      data-testid="toolbar"
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        background: '#fff',
        border: '1px solid #d0d0d0',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        zIndex: 10,
      }}
    >
      <button
        type="button"
        data-testid="select-btn"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        onClick={() => setTool('select')}
        style={toolButtonStyle(tool === 'select')}
      >
        Select
      </button>
      <button
        type="button"
        data-testid="text-btn"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        disabled={!canEdit}
        onClick={() => setTool('text')}
        style={toolButtonStyle(tool === 'text', canEdit)}
      >
        Text
      </button>
      <button
        type="button"
        data-testid="sticky-btn"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        onClick={onCreateSticky}
        style={toolButtonStyle(false)}
      >
        Sticky
      </button>
      <div ref={menuRef} style={{ position: 'relative' }}>
        <button
          type="button"
          data-testid="shape-btn"
          aria-label="Shape (S)"
          aria-pressed={tool === 'shape'}
          aria-haspopup="menu"
          aria-expanded={shapeMenuOpen}
          disabled={!canEdit}
          onClick={() => {
            setTool('shape');
            setShapeMenuOpen((open) => !open);
          }}
          style={toolButtonStyle(tool === 'shape', canEdit)}
        >
          Shape
        </button>
        {shapeMenuOpen && (
          <div
            role="menu"
            aria-label="Shape kind"
            data-testid="shape-menu"
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 4,
              display: 'flex',
              flexDirection: 'column',
              minWidth: 110,
              padding: 4,
              background: '#fff',
              border: '1px solid #d0d0d0',
              borderRadius: 6,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              zIndex: 20,
            }}
          >
            {SHAPE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                role="menuitem"
                data-testid={`shape-kind-${kind}`}
                aria-label={`${SHAPE_KIND_LABELS[kind]} shape`}
                aria-pressed={shapeKind === kind}
                onClick={() => {
                  setShapeKind(kind);
                  setShapeMenuOpen(false);
                }}
                style={{
                  padding: '6px 10px',
                  border: 'none',
                  borderRadius: 4,
                  background: shapeKind === kind ? '#e8f0fe' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 13,
                  textAlign: 'left',
                }}
              >
                {SHAPE_KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        data-testid="connector-btn"
        aria-label="Connector (L)"
        aria-pressed={tool === 'connector'}
        disabled={!canEdit}
        onClick={() => setTool('connector')}
        style={toolButtonStyle(tool === 'connector', canEdit)}
      >
        Connector
      </button>
      <button
        type="button"
        data-testid="pen-btn"
        aria-label="Pen (P)"
        aria-pressed={tool === 'pen'}
        disabled={!canEdit}
        onClick={() => setTool('pen')}
        style={toolButtonStyle(tool === 'pen', canEdit)}
      >
        Pen
      </button>
      <button
        type="button"
        data-testid="image-btn"
        aria-label="Image (I)"
        title="Image (I) – or drag, drop or paste images onto the board"
        disabled={!canEdit}
        onClick={() => onCreateImage?.()}
        style={toolButtonStyle(false, canEdit)}
      >
        Image
      </button>
      <div style={{ width: 1, background: '#d0d0d0', margin: '4px 2px' }} />
      <button
        type="button"
        data-testid="undo-btn"
        title="Undo (Ctrl/Cmd+Z)"
        aria-label="Undo (Ctrl/Cmd+Z)"
        disabled={!undo.canUndo}
        onClick={undo.undo}
        style={{
          padding: '6px 10px',
          border: '1px solid transparent',
          borderRadius: 6,
          background: 'transparent',
          cursor: undo.canUndo ? 'pointer' : 'default',
          fontSize: 13,
          opacity: undo.canUndo ? 1 : 0.4,
        }}
      >
        Undo
      </button>
      <button
        type="button"
        data-testid="redo-btn"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        aria-label="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={!undo.canRedo}
        onClick={undo.redo}
        style={{
          padding: '6px 10px',
          border: '1px solid transparent',
          borderRadius: 6,
          background: 'transparent',
          cursor: undo.canRedo ? 'pointer' : 'default',
          fontSize: 13,
          opacity: undo.canRedo ? 1 : 0.4,
        }}
      >
        Redo
      </button>
    </div>
  );
}
