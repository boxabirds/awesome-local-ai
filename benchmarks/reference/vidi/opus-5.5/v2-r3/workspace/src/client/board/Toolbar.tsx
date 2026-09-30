import type { ReactNode } from 'react';
import { SHAPE_KINDS } from '../../shared/config';
import type { ShapeKind } from '../../shared/objects/shape';
import { SHAPE_KIND_NAMES } from '../objects/ShapeObject';
import type { Tool } from './useTool';

export const STICKY_BUTTON_TOOLTIP = 'Sticky note (N) – or double-click the board';

function ShapeKindIcon({ kind }: { kind: ShapeKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 };
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      {kind === 'rect' && <rect x="2.5" y="4.5" width="13" height="9" rx="0.5" {...common} />}
      {kind === 'ellipse' && <ellipse cx="9" cy="9" rx="6.5" ry="5" {...common} />}
      {kind === 'diamond' && <path d="M9 2.5 15.5 9 9 15.5 2.5 9Z" strokeLinejoin="round" {...common} />}
    </svg>
  );
}

/**
 * Left-side vertical toolbar: Select and Text tools (story 9), Sticky note,
 * Shape (with its kind menu while active) and Connector (story 10), Pen (with
 * its options while active, story 11), Image (story 12), then children (undo).
 */
export function Toolbar(props: {
  onCreateSticky(): void;
  disabled?: boolean;
  tool?: Tool;
  onTool?(t: Tool): void;
  shapeKind?: ShapeKind;
  onShapeKind?(k: ShapeKind): void;
  /** Story 11: the pen options, shown next to the Pen button while the Pen is active. */
  penToolbar?: ReactNode;
  /** Story 12: the Image button opens the system file picker. */
  onImage?(): void;
  children?: ReactNode;
}) {
  const shapeKind = props.shapeKind ?? 'rect';
  const tool = props.tool ?? 'select';
  return (
    <div className="toolbar" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      <button
        type="button"
        className="toolbar-button"
        aria-label="Select (V)"
        title="Select (V)"
        aria-pressed={tool === 'select'}
        onClick={() => props.onTool?.('select')}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
          <path
            d="M6 3.5v14l3.6-3.4 2.5 5.4 2.3-1-2.5-5.3 4.9-.2L6 3.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-button"
        aria-label="Text (T)"
        title="Text (T)"
        aria-pressed={tool === 'text'}
        disabled={props.disabled}
        onClick={() => props.onTool?.('text')}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
          <path
            d="M5 5.5h12M11 5.5v12M8.5 17.5h5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-button"
        aria-label="Sticky note (N)"
        title={STICKY_BUTTON_TOOLTIP}
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
          <path
            d="M4 3.5h14a.5.5 0 0 1 .5.5v9.5l-5 5H4a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z"
            fill="#FFF59D"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M18.5 13.5h-4.5a.5.5 0 0 0-.5.5v4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="toolbar-shape">
        <button
          type="button"
          className="toolbar-button"
          aria-label="Shape (S)"
          title="Shape (S)"
          aria-pressed={tool === 'shape'}
          aria-haspopup="true"
          aria-expanded={tool === 'shape'}
          disabled={props.disabled}
          onClick={() => props.onTool?.('shape')}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
            <rect x="3.5" y="3.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="14" cy="14" r="4.5" fill="#fff" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
        {tool === 'shape' && (
          <div className="shape-kind-menu" role="group" aria-label="Shape kind">
            {SHAPE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className="shape-kind-button"
                aria-label={SHAPE_KIND_NAMES[k]}
                title={SHAPE_KIND_NAMES[k]}
                aria-pressed={shapeKind === k}
                onClick={() => props.onShapeKind?.(k)}
              >
                <ShapeKindIcon kind={k} />
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="toolbar-button"
        aria-label="Connector (L)"
        title="Connector (L)"
        aria-pressed={tool === 'connector'}
        disabled={props.disabled}
        onClick={() => props.onTool?.('connector')}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
          <path d="M4.5 17.5 16 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M10.5 5.5h6v6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="toolbar-pen">
        <button
          type="button"
          className="toolbar-button"
          aria-label="Pen (P)"
          title="Pen (P)"
          aria-pressed={tool === 'pen'}
          disabled={props.disabled}
          onClick={() => props.onTool?.('pen')}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
            <path
              d="M14.5 4.5 17.5 7.5 8 17l-4 1 1-4 9.5-9.5Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path d="M12.5 6.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
        {tool === 'pen' && props.penToolbar}
      </div>
      {props.onImage && (
        <button
          type="button"
          className="toolbar-button"
          aria-label="Image (I)"
          title="Image (I)"
          disabled={props.disabled}
          onClick={props.onImage}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
            <rect x="3.5" y="4.5" width="15" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="8.5" cy="9" r="1.5" fill="currentColor" />
            <path d="M4 16l4.5-4.5 3.5 3.5 2-2 4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {props.children}
    </div>
  );
}
