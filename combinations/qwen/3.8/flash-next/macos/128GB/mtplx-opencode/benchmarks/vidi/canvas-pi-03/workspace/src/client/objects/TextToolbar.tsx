import type { CSSProperties } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

/** The four size steps, in the order the toolbar shows them. */
export const TEXT_SIZE_STEPS = Object.keys(TEXT_SIZES) as TextSize[];

export interface TextToolbarProps {
  /** The size the selected block is in now (its button reads as pressed). */
  size: TextSize;
  /** Pick a size. The label is the step, so a screen reader says "Text size L". */
  onSize(size: TextSize): void;
  /** Optional delete control. The selection bar already carries one, so the
   * board renders this toolbar without it. */
  onDelete?(): void;
}

function stepStyle(active: boolean): CSSProperties {
  return {
    minWidth: 26,
    height: 22,
    padding: '0 4px',
    border: active ? '1px solid #2563eb' : '1px solid rgba(0,0,0,0.25)',
    borderRadius: 5,
    background: active ? '#DBEAFE' : '#ffffff',
    color: '#111',
    cursor: 'pointer',
    fontSize: 11,
    lineHeight: '20px',
  };
}

/**
 * The size stepper of one selected text block (story 9, contract `text.object`).
 *
 * Four steps, not a free font-size field: the stored box is derived from the
 * size, and a step is something a learner can predict. The current step reads
 * as pressed, so the block's size is visible without measuring it.
 */
export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps) {
  return (
    <>
      <span
        data-testid="text-toolbar"
        role="group"
        aria-label="Text size"
        onPointerDown={(e) => e.stopPropagation()}
        style={{ display: 'flex', gap: 2, alignItems: 'center' }}
      >
        {TEXT_SIZE_STEPS.map((step) => (
          <button
            key={step}
            type="button"
            aria-label={`Text size ${step}`}
            aria-pressed={step === size}
            title={`Text size ${step}`}
            data-testid={`text-size-${step}`}
            onClick={() => onSize(step)}
            style={stepStyle(step === size)}
          >
            {step}
          </button>
        ))}
      </span>
      {onDelete !== undefined ? (
        <button
          type="button"
          aria-label="Delete text block"
          data-testid="text-delete"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onDelete()}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#dc2626' }}
        >
          &#128465;
        </button>
      ) : null}
    </>
  );
}
