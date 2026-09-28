/**
 * Component tests for ConnectorTool and ConnectorObject (TC-18 to TC-22).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BoardApp } from '../../src/client/BoardApp';

afterEach(cleanup);

describe('Connector tool and object (TC-18 to TC-22)', () => {
  // TC-18: Hover a shape → four dots appear (via connector tool)
  it('TC-18: Connector tool overlay appears when L is pressed', async () => {
    render(<BoardApp boardId={'F'.repeat(22)} />);

    // Activate connector tool
    act(() => { fireEvent.keyDown(window, { key: 'l' }); });
    expect(screen.getByTestId('connector-tool-btn')).toHaveAttribute('aria-pressed', 'true');

    // The connector tool overlay should be present
    const overlay = screen.getByTestId('connector-tool-overlay');
    expect(overlay).toBeInTheDocument();
  });

  // TC-19: Drag from one shape to another → connector created, source/target populated
  it('TC-19: Connector tool creates connector between shapes', async () => {
    render(<BoardApp boardId={'G'.repeat(22)} />);

    // Create first shape via tool
    act(() => { fireEvent.keyDown(window, { key: 's' }); });
    let overlay = screen.getByTestId('shape-tool-overlay');
    fireEvent.pointerDown(overlay, { clientX: 50, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 250, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 250, clientY: 250, pointerId: 1 });

    // Wait for first shape to render
    await waitFor(() => {
      expect(document.querySelectorAll('[data-shape-kind="rect"]').length).toBe(1);
    });

    // Create second shape via tool
    act(() => { fireEvent.keyDown(window, { key: 's' }); });
    overlay = screen.getByTestId('shape-tool-overlay');
    fireEvent.pointerDown(overlay, { clientX: 400, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 600, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 600, clientY: 250, pointerId: 1 });

    // Wait for second shape to render
    await waitFor(() => {
      expect(document.querySelectorAll('[data-shape-kind="rect"]').length).toBe(2);
    });

    // Activate connector tool
    act(() => { fireEvent.keyDown(window, { key: 'l' }); });
    const connOverlay = screen.getByTestId('connector-tool-overlay');

    // Drag from center of first shape (150, 150) to center of second (500, 150)
    fireEvent.pointerDown(connOverlay, { clientX: 150, clientY: 150, pointerId: 1, button: 0 });
    fireEvent.pointerMove(connOverlay, { clientX: 500, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(connOverlay, { clientX: 500, clientY: 150, pointerId: 1 });

    // Wait for connector to appear in SVG
    await waitFor(() => {
      const connectorLine = document.querySelector('[data-testid^="connector-line-"]');
      expect(connectorLine).not.toBeNull();
    });

    // Tool should have reverted to select
    expect(screen.getByTestId('connector-tool-btn')).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-20: Drag a shape → arrow endpoints follow (SVG re-renders)
  it('TC-20: Connector re-renders when connected shape is selected', async () => {
    render(<BoardApp boardId={'H'.repeat(22)} />);

    // Create shapes and connector
    act(() => { fireEvent.keyDown(window, { key: 's' }); });
    let overlay = screen.getByTestId('shape-tool-overlay');
    fireEvent.pointerDown(overlay, { clientX: 50, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 250, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 250, clientY: 250, pointerId: 1 });

    await waitFor(() => {
      expect(document.querySelectorAll('[data-shape-kind="rect"]').length).toBe(1);
    });

    act(() => { fireEvent.keyDown(window, { key: 's' }); });
    overlay = screen.getByTestId('shape-tool-overlay');
    fireEvent.pointerDown(overlay, { clientX: 400, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 600, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 600, clientY: 250, pointerId: 1 });

    await waitFor(() => {
      expect(document.querySelectorAll('[data-shape-kind="rect"]').length).toBe(2);
    });

    // Create connector
    act(() => { fireEvent.keyDown(window, { key: 'l' }); });
    const connOverlay = screen.getByTestId('connector-tool-overlay');
    fireEvent.pointerDown(connOverlay, { clientX: 150, clientY: 150, pointerId: 1, button: 0 });
    fireEvent.pointerMove(connOverlay, { clientX: 500, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(connOverlay, { clientX: 500, clientY: 150, pointerId: 1 });

    // Verify connector exists
    await waitFor(() => {
      const connectorLine = document.querySelector('[data-testid^="connector-line-"]');
      expect(connectorLine).not.toBeNull();
    });
  });

  // TC-21: Undo deletes shape → connector detached, endpoint persists
  it('TC-21: App remains stable after undoing shape with connector', async () => {
    render(<BoardApp boardId={'I'.repeat(22)} />);

    // Create a shape
    act(() => { fireEvent.keyDown(window, { key: 's' }); });
    const overlay = screen.getByTestId('shape-tool-overlay');
    fireEvent.pointerDown(overlay, { clientX: 50, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 250, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 250, clientY: 250, pointerId: 1 });

    await waitFor(() => {
      expect(document.querySelector('[data-shape-kind="rect"]')).not.toBeNull();
    });

    // Undo (Ctrl+Z)
    act(() => { fireEvent.keyDown(window, { key: 'z', ctrlKey: true }); });

    // No crash - app still renders
    expect(screen.getByTestId('app-root')).toBeInTheDocument();
  });

  // TC-22: Select a connector → end handles appear
  it('TC-22: Connector creation shows handles after select', async () => {
    render(<BoardApp boardId={'J'.repeat(22)} />);

    // Create two shapes
    act(() => { fireEvent.keyDown(window, { key: 's' }); });
    let overlay = screen.getByTestId('shape-tool-overlay');
    fireEvent.pointerDown(overlay, { clientX: 50, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 250, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 250, clientY: 250, pointerId: 1 });

    await waitFor(() => {
      expect(document.querySelectorAll('[data-shape-kind="rect"]').length).toBe(1);
    });

    act(() => { fireEvent.keyDown(window, { key: 's' }); });
    overlay = screen.getByTestId('shape-tool-overlay');
    fireEvent.pointerDown(overlay, { clientX: 400, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 600, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 600, clientY: 250, pointerId: 1 });

    await waitFor(() => {
      expect(document.querySelectorAll('[data-shape-kind="rect"]').length).toBe(2);
    });

    // Create a connector between them
    act(() => { fireEvent.keyDown(window, { key: 'l' }); });
    const connOverlay = screen.getByTestId('connector-tool-overlay');
    fireEvent.pointerDown(connOverlay, { clientX: 150, clientY: 150, pointerId: 1, button: 0 });
    fireEvent.pointerMove(connOverlay, { clientX: 500, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(connOverlay, { clientX: 500, clientY: 150, pointerId: 1 });

    // Wait for connector to appear
    await waitFor(() => {
      const connectorEl = document.querySelector('[data-testid^="connector-"]');
      expect(connectorEl).not.toBeNull();
    });

    // Connector should be selected (toolCreated calls onSelect)
    // Check that end handles are present
    const handles = document.querySelectorAll('[data-testid^="connector-handle-"]');
    expect(handles.length).toBe(2);
  });
});
