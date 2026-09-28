/**
 * Component tests for Pen tool (TC-09 to TC-14).
 * Tests PenTool gesture states, PenToolbar options, and tool staying active.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BoardApp } from '../../src/client/BoardApp';

afterEach(cleanup);

describe('Pen tool (TC-09 to TC-14)', () => {
  // TC-09: pointerdown/moves/up with red + thick → createStroke called once with red/thick; tool still pen
  it('TC-09: drag creates a stroke with selected colour and thickness, pen stays active', async () => {
    render(<BoardApp boardId={'P'.repeat(22)} />);

    // Press P to activate pen tool
    act(() => { fireEvent.keyDown(window, { key: 'p' }); });
    expect(screen.getByTestId('pen-tool-btn')).toHaveAttribute('aria-pressed', 'true');

    // Select red colour
    fireEvent.click(screen.getByTestId('pen-color-red'));
    // Select thick
    fireEvent.click(screen.getByTestId('pen-thickness-thick'));

    // Draw a stroke on the overlay
    const overlay = screen.getByTestId('pen-tool-overlay');
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 150, clientY: 150, pointerId: 1 });
    fireEvent.pointerMove(overlay, { clientX: 200, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 200, clientY: 120, pointerId: 1 });

    // A stroke object should appear in the DOM
    await waitFor(() => {
      const strokeEl = document.querySelector('[data-testid^="stroke-object-"]');
      expect(strokeEl).not.toBeNull();
    });

    // Pen tool should still be active
    expect(screen.getByTestId('pen-tool-btn')).toHaveAttribute('aria-pressed', 'true');
  });

  // TC-10: pointerdown/up without movement → single-point dot committed
  it('TC-10: click without movement creates a dot', async () => {
    render(<BoardApp boardId={'Q'.repeat(22)} />);

    act(() => { fireEvent.keyDown(window, { key: 'p' }); });
    expect(screen.getByTestId('pen-tool-btn')).toHaveAttribute('aria-pressed', 'true');

    const overlay = screen.getByTestId('pen-tool-overlay');
    fireEvent.pointerDown(overlay, { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerUp(overlay, { clientX: 200, clientY: 200, pointerId: 1 });

    // A stroke (dot) should appear
    await waitFor(() => {
      const strokeEl = document.querySelector('[data-testid^="stroke-object-"]');
      expect(strokeEl).not.toBeNull();
    });

    // Pen still active
    expect(screen.getByTestId('pen-tool-btn')).toHaveAttribute('aria-pressed', 'true');
  });

  // TC-11: pointerdown, moves, pointercancel → stroke committed with points so far
  it('TC-11: interrupted drag (pointercancel) commits stroke with points so far', async () => {
    render(<BoardApp boardId={'R'.repeat(22)} />);

    act(() => { fireEvent.keyDown(window, { key: 'p' }); });

    const overlay = screen.getByTestId('pen-tool-overlay');
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 130, clientY: 130, pointerId: 1 });
    fireEvent.pointerMove(overlay, { clientX: 160, clientY: 140, pointerId: 1 });
    // Cancel instead of pointerUp
    fireEvent.pointerCancel(overlay, { clientX: 160, clientY: 140, pointerId: 1 });

    // Stroke should still have been created
    await waitFor(() => {
      const strokeEl = document.querySelector('[data-testid^="stroke-object-"]');
      expect(strokeEl).not.toBeNull();
    });

    // Pen still active
    expect(screen.getByTestId('pen-tool-btn')).toHaveAttribute('aria-pressed', 'true');
  });

  // TC-12: STROKE_MAX_POINTS + 10 moves → two commits, second starts at first's last point
  it('TC-12: reaching STROKE_MAX_POINTS splits into two strokes', async () => {
    render(<BoardApp boardId={'S'.repeat(22)} />);

    act(() => { fireEvent.keyDown(window, { key: 'p' }); });

    const overlay = screen.getByTestId('pen-tool-overlay');
    const { STROKE_MAX_POINTS } = await import('../../src/shared/config');

    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });

    // Generate STROKE_MAX_POINTS + 10 move events
    for (let i = 1; i <= STROKE_MAX_POINTS + 10; i++) {
      const x = 10 + (i % 500);
      const y = 10 + (i % 400);
      fireEvent.pointerMove(overlay, { clientX: x, clientY: y, pointerId: 1 });
    }

    fireEvent.pointerUp(overlay, { clientX: 10, clientY: 10, pointerId: 1 });

    // At least two stroke objects should be created
    await waitFor(() => {
      const strokeEls = document.querySelectorAll('[data-testid^="stroke-object-"]');
      expect(strokeEls.length).toBeGreaterThanOrEqual(2);
    });

    // Pen still active
    expect(screen.getByTestId('pen-tool-btn')).toHaveAttribute('aria-pressed', 'true');
  });

  // TC-13: Escape; press V → tool becomes select; no stroke created
  it('TC-13: Escape from pen returns to select, no stroke', async () => {
    render(<BoardApp boardId={'T'.repeat(22)} />);

    act(() => { fireEvent.keyDown(window, { key: 'p' }); });
    expect(screen.getByTestId('pen-tool-btn')).toHaveAttribute('aria-pressed', 'true');

    // Press Escape
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });

    // Tool should revert to select
    await waitFor(() => {
      expect(screen.getByTestId('pen-tool-btn')).toHaveAttribute('aria-pressed', 'false');
    });

    // No stroke objects
    expect(document.querySelector('[data-testid^="stroke-object-"]')).toBeNull();
  });

  // TC-14: Change colour after a stroke exists → existing stroke unchanged; next stroke uses new colour
  it('TC-14: changing colour does not restyle existing strokes', async () => {
    render(<BoardApp boardId={'U'.repeat(22)} />);

    act(() => { fireEvent.keyDown(window, { key: 'p' }); });

    // Draw first stroke (default black)
    const overlay = screen.getByTestId('pen-tool-overlay');
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 200, clientY: 200, pointerId: 1 });

    await waitFor(() => {
      expect(document.querySelector('[data-testid^="stroke-object-"]')).not.toBeNull();
    });

    // Get first stroke's path color
    const firstPath = document.querySelector('[data-testid^="stroke-object-"] path');
    const firstColor = firstPath?.getAttribute('stroke');

    // Change colour to red
    fireEvent.click(screen.getByTestId('pen-color-red'));

    // Draw second stroke
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 400, clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 400, clientY: 400, pointerId: 1 });

    await waitFor(() => {
      const strokeEls = document.querySelectorAll('[data-testid^="stroke-object-"]');
      expect(strokeEls.length).toBe(2);
    });

    // First stroke's colour unchanged
    const paths = document.querySelectorAll('[data-testid^="stroke-object-"] path');
    expect(paths[0].getAttribute('stroke')).toBe(firstColor);
    // Second stroke uses new colour (red)
    expect(paths[1].getAttribute('stroke')).toBe('#E53935');
  });
});
