import type { UseUndoResult } from './useUndo';
import type { Tool } from './useTool';
import type { ToolId } from '../tools/useActiveTool';
import type { ShapeKind } from '../../shared/config';
import { UndoButtons } from './UndoButtons';
import { useState, useRef, useEffect, useCallback } from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  undoState?: UseUndoResult;
  tool?: Tool;
  onToolChange?(t: Tool): void;
  activeTool?: ToolId;
  shapeKind?: ShapeKind;
  onActiveToolChange?(t: ToolId): void;
  onShapeKindChange?(k: ShapeKind): void;
}

/**
 * Fixed left-side toolbar with Select, Text, Shape, Connector, Sticky note buttons, plus undo/redo.
 */
export function Toolbar(props: ToolbarProps) {
  const {
    onCreateSticky, disabled, undoState, tool = 'select', onToolChange,
    activeTool, shapeKind = 'rect', onActiveToolChange, onShapeKindChange,
  } = props;

  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const shapeBtnRef = useRef<HTMLButtonElement>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  const toggleShapeMenu = useCallback(() => {
    setShapeMenuOpen((v) => !v);
  }, []);

  const selectShapeKind = useCallback((k: ShapeKind) => {
    onShapeKindChange?.(k);
    onActiveToolChange?.('shape');
    setShapeMenuOpen(false);
  }, [onShapeKindChange, onActiveToolChange]);

  // Close shape menu on outside click
  useEffect(() => {
    if (!shapeMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (shapeBtnRef.current && !shapeBtnRef.current.contains(e.target as Node)) {
        const menu = document.querySelector('[data-testid="shape-kind-menu"]');
        if (menu && !menu.contains(e.target as Node)) {
          setShapeMenuOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [shapeMenuOpen]);

  const t = activeTool ?? tool;
  // Text and select buttons use the 'tool' prop (from useTool/useBoardKeys)
  const textActive = tool === 'text';
  const selectActive = tool === 'select' && t === 'select';

  return (
    <div
      className="toolbar-left"
      data-testid="toolbar-left"
      onPointerDown={handlePointerDown}
    >
      {(onToolChange || onActiveToolChange) && (
        <>
          <button
            type="button"
            aria-label="Select (V)"
            aria-pressed={selectActive}
            title="Select tool"
            className={`toolbar-btn${selectActive ? ' toolbar-btn-active' : ''}`}
            data-testid="select-tool-btn"
            onClick={() => { onActiveToolChange?.('select'); onToolChange?.('select'); }}
          >
            <span className="toolbar-btn-icon" aria-hidden="true">
              {'\u2191'}
            </span>
            <span className="toolbar-btn-label">Select</span>
          </button>
          <button
            type="button"
            aria-label="Text (T)"
            aria-pressed={textActive}
            title="Text tool"
            className={`toolbar-btn${textActive ? ' toolbar-btn-active' : ''}`}
            data-testid="text-tool-btn"
            onClick={() => { onActiveToolChange?.('select'); onToolChange?.('text'); }}
            disabled={disabled}
          >
            <span className="toolbar-btn-icon" aria-hidden="true">
              {'T'}
            </span>
            <span className="toolbar-btn-label">Text</span>
          </button>
        </>
      )}
      {onActiveToolChange && (
        <>
          <div style={{ position: 'relative' }}>
            <button
              ref={shapeBtnRef}
              type="button"
              aria-label="Shape (S)"
              aria-pressed={t === 'shape'}
              title="Shape tool"
              className={`toolbar-btn${t === 'shape' ? ' toolbar-btn-active' : ''}`}
              data-testid="shape-tool-btn"
              onClick={toggleShapeMenu}
              disabled={disabled}
            >
              <span className="toolbar-btn-icon" aria-hidden="true">
                {'\u25AD'}
              </span>
              <span className="toolbar-btn-label">Shape</span>
            </button>
            {shapeMenuOpen && (
              <div
                data-testid="shape-kind-menu"
                style={{
                  position: 'absolute',
                  left: '100%',
                  top: 0,
                  background: '#fff',
                  borderRadius: 6,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  padding: 4,
                  zIndex: 1001,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <button
                  type="button"
                  aria-label="Rectangle"
                  aria-pressed={shapeKind === 'rect'}
                  data-testid="shape-kind-rect"
                  className={`toolbar-btn${shapeKind === 'rect' ? ' toolbar-btn-active' : ''}`}
                  onClick={() => selectShapeKind('rect')}
                >
                  <span className="toolbar-btn-icon">{'\u25AD'}</span>
                  <span className="toolbar-btn-label">Rectangle</span>
                </button>
                <button
                  type="button"
                  aria-label="Ellipse"
                  aria-pressed={shapeKind === 'ellipse'}
                  data-testid="shape-kind-ellipse"
                  className={`toolbar-btn${shapeKind === 'ellipse' ? ' toolbar-btn-active' : ''}`}
                  onClick={() => selectShapeKind('ellipse')}
                >
                  <span className="toolbar-btn-icon">{'\u25CB'}</span>
                  <span className="toolbar-btn-label">Ellipse</span>
                </button>
                <button
                  type="button"
                  aria-label="Diamond"
                  aria-pressed={shapeKind === 'diamond'}
                  data-testid="shape-kind-diamond"
                  className={`toolbar-btn${shapeKind === 'diamond' ? ' toolbar-btn-active' : ''}`}
                  onClick={() => selectShapeKind('diamond')}
                >
                  <span className="toolbar-btn-icon">{'\u25C7'}</span>
                  <span className="toolbar-btn-label">Diamond</span>
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Connector (L)"
            aria-pressed={t === 'connector'}
            title="Connector tool"
            className={`toolbar-btn${t === 'connector' ? ' toolbar-btn-active' : ''}`}
            data-testid="connector-tool-btn"
            onClick={() => onActiveToolChange('connector')}
            disabled={disabled}
          >
            <span className="toolbar-btn-icon" aria-hidden="true">
              {'\u2197'}
            </span>
            <span className="toolbar-btn-label">Connector</span>
          </button>
        </>
      )}
      <button
        type="button"
        aria-label="Sticky note"
        title={`Sticky note \u2013 or double-click the board`}
        className="toolbar-btn"
        data-testid="create-sticky-btn"
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <span className="toolbar-btn-icon" aria-hidden="true">
          {'\u25A1'}
        </span>
        <span className="toolbar-btn-label">Sticky note</span>
      </button>
      {undoState && <UndoButtons {...undoState} />}
    </div>
  );
}
