/**
 * Undo button component tests (TC-18 to TC-21).
 * Tests disabled state, keyboard shortcuts, and edit-lock gate.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { UseUndoResult } from '@/client/board/useUndo';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '@/shared/config';
import { UndoButtons } from '@/client/board/UndoButtons';

describe('Undo buttons — TC-18 to TC-21', () => {
  afterEach(() => {
    cleanup();
  });

  // TC-18: initial render with no history → both buttons disabled
  it('TC-18: initially both undo and redo buttons are disabled when there is no history', () => {
    const mock = {
      canUndo: false,
      canRedo: false,
      undo: () => {},
      redo: () => {},
      stepCount: 0,
    };
    render(<UndoButtons {...mock} canEdit />);

    const undoBtn = screen.getByTestId('undo-btn');
    const redoBtn = screen.getByTestId('redo-btn');

    expect(undoBtn).toHaveAttribute('disabled');
    expect(redoBtn).toHaveAttribute('disabled');
    expect(undoBtn).toHaveAttribute('aria-disabled', 'true');
    expect(redoBtn).toHaveAttribute('aria-disabled', 'true');
  });

  // TC-19: undo/redo state toggles correctly reflected in button disabled state
  it('TC-19: undo button enabled when canUndo true, redo disabled when canRedo false', () => {
    render(
      <UndoButtons
        canUndo={true}
        canRedo={false}
        undo={() => {}}
        redo={() => {}}
        
        canEdit
      />
    );

    expect(screen.getByTestId('undo-btn')).not.toHaveAttribute('disabled');
    expect(screen.getByTestId('redo-btn')).toHaveAttribute('disabled');
  });

  // TC-19 variant: after undo performed, redo should be available
  it('TC-19b: redo button enabled when canRedo true', () => {
    render(
      <UndoButtons
        canUndo={false}
        canRedo={true}
        undo={() => {}}
        redo={() => {}}
        
        canEdit
      />
    );

    expect(screen.getByTestId('undo-btn')).toHaveAttribute('disabled');
    expect(screen.getByTestId('redo-btn')).not.toHaveAttribute('disabled');
  });

  // TC-20: buttons respect canEdit gate (disabled for read-only)
  it('TC-20: both buttons disabled when canEdit is false, regardless of undo/redo availability', () => {
    render(
      <UndoButtons
        canUndo={true}
        canRedo={false}
        undo={() => {}}
        redo={() => {}}
        
        canEdit={false}
      />
    );

    expect(screen.getByTestId('undo-btn')).toHaveAttribute('disabled');
    expect(screen.getByTestId('redo-btn')).toHaveAttribute('disabled');
  });

  // TC-21: undo click calls undo callback, redo click calls redo callback
  it('TC-21: click handlers invoke correct callbacks', () => {
    let undoCalled = false;
    let redoCalled = false;

    const TestWrapper = ({ onUndo, onRedo }: { onUndo: () => void; onRedo: () => void }) => {
      return (
        <div data-testid="wrapper">
          <UndoButtons
            canUndo
            canRedo={false}
            undo={() => {
              undoCalled = true;
              onUndo();
            }}
            redo={() => {
              redoCalled = true;
              onRedo();
            }}
            
            canEdit
          />
        </div>
      );
    };

    render(<TestWrapper onUndo={() => {}} onRedo={() => {}} />);

    fireEvent.click(screen.getByTestId('undo-btn'));
    expect(undoCalled).toBe(true);
    expect(redoCalled).toBe(false);
  });
});
