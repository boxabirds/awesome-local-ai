/**
 * Component tests for ShapeTool, ShapeObject, ShapeToolbar (TC-15 to TC-17, TC-28).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BoardApp } from '../../src/client/BoardApp';

afterEach(cleanup);

describe('Shape tool and object (TC-15, TC-16, TC-17, TC-28)', () => {
  // TC-15: Shape tool: pointerdown/move/up creates a shape
  it('TC-15: S tool drag creates a shape and selects it', async () => {
    render(<BoardApp boardId={'B'.repeat(22)} />);

    // Press S to activate shape tool
    act(() => { fireEvent.keyDown(window, { key: 's' }); });
    expect(screen.getByTestId('shape-tool-btn')).toHaveAttribute('aria-pressed', 'true');

    // Find the shape overlay and drag
    const overlay = screen.getByTestId('shape-tool-overlay');
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 300, clientY: 220, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 300, clientY: 220, pointerId: 1 });

    // Tool should revert to select
    await waitFor(() => {
      expect(screen.getByTestId('shape-tool-btn')).toHaveAttribute('aria-pressed', 'false');
    });

    // A shape should have been created (check DOM)
    await waitFor(() => {
      const shapeEl = document.querySelector('[data-shape-kind="rect"]');
      expect(shapeEl).not.toBeNull();
    });
  });

  // TC-16: dblclick a shape → editor opens, type 600 chars → clamped to 500
  it('TC-16: label editor clamps to SHAPE_LABEL_MAX_CHARS', async () => {
    render(<BoardApp boardId={'C'.repeat(22)} />);

    // Create a shape via keyboard + drag
    act(() => { fireEvent.keyDown(window, { key: 's' }); });
    const overlay = screen.getByTestId('shape-tool-overlay');
    fireEvent.pointerDown(overlay, { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 400, clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 400, clientY: 400, pointerId: 1 });

    // Wait for shape to appear in DOM
    await waitFor(() => {
      expect(document.querySelector('[data-shape-kind="rect"]')).not.toBeNull();
    });

    // Find the shape and double-click it
    const shapeEl = document.querySelector('[data-shape-kind="rect"]') as HTMLElement;
    fireEvent.doubleClick(shapeEl);

    // Editor should appear
    await waitFor(() => {
      const editor = document.querySelector('[data-testid^="shape-editor-"]');
      expect(editor).not.toBeNull();
    });

    const editor = document.querySelector('[data-testid^="shape-editor-"]') as HTMLTextAreaElement;

    // Set 600 chars via native setter (to trigger React's onInput)
    const longText = 'x'.repeat(600);
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value',
    )?.set;
    nativeInputValueSetter?.call(editor, longText);
    fireEvent.input(editor);

    // After React re-renders, the textarea should show at most 500 chars
    await waitFor(() => {
      expect(editor.value.length).toBeLessThanOrEqual(500);
    });
  });

  // TC-17: Click blue fill and red outline swatches → colours applied
  it('TC-17: Shape toolbar swatches apply colours', async () => {
    render(<BoardApp boardId={'D'.repeat(22)} />);

    // Create a shape
    act(() => { fireEvent.keyDown(window, { key: 's' }); });
    const overlay = screen.getByTestId('shape-tool-overlay');
    fireEvent.pointerDown(overlay, { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 400, clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 400, clientY: 400, pointerId: 1 });

    // Shape toolbar should appear (shape is selected after creation)
    await waitFor(() => {
      expect(screen.getByTestId('shape-toolbar')).toBeInTheDocument();
    });

    // Click blue fill
    fireEvent.click(screen.getByTestId('fill-blue'));

    // Click red outline
    fireEvent.click(screen.getByTestId('stroke-red'));

    // Check that shape SVG has the correct colours
    await waitFor(() => {
      const shapeEl = document.querySelector('[data-shape-kind="rect"]');
      expect(shapeEl).not.toBeNull();
      const rect = shapeEl!.querySelector('rect');
      expect(rect).not.toBeNull();
      expect(rect!.getAttribute('fill')).toBe('#BBDEFB'); // blue
      expect(rect!.getAttribute('stroke')).toBe('#E53935'); // red
    });
  });

  // TC-28: Shape tool drag starting over an existing sticky → sticky position unchanged
  it('TC-28: Shape tool drag over sticky does not move it', async () => {
    render(<BoardApp boardId={'E'.repeat(22)} />);

    // Create a sticky note first (via button)
    fireEvent.click(screen.getByTestId('create-sticky-btn'));

    // Dismiss the editor
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });

    // Get sticky position before
    await waitFor(() => {
      expect(document.querySelector('[data-testid^="sticky-"]')).not.toBeNull();
    });
    const stickyEl = document.querySelector('[data-testid^="sticky-"]') as HTMLElement;
    const posBefore = stickyEl.style.left + ',' + stickyEl.style.top;

    // Activate shape tool and drag over the sticky
    act(() => { fireEvent.keyDown(window, { key: 's' }); });
    const overlay = screen.getByTestId('shape-tool-overlay');
    // Drag from center of screen (where sticky likely is)
    fireEvent.pointerDown(overlay, { clientX: 500, clientY: 400, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 600, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 600, clientY: 500, pointerId: 1 });

    // Sticky position should be unchanged
    const stickyEl2 = document.querySelector('[data-testid^="sticky-"]') as HTMLElement;
    const posAfter = stickyEl2.style.left + ',' + stickyEl2.style.top;
    expect(posAfter).toBe(posBefore);
  });
});
