// Story 10 component tests: the active tool and return-to-Select (TC-22).
//
// The Shape and Connector tools are client-only toggles driven by the S / L
// shortcuts (or toolbar buttons). Creating anything through them selects the
// new object and switches the active tool back to Select (tools.return_to_
// select). Pressing Escape while the tool is active returns to Select and
// creates nothing — even mid-drag (the tool unmounts and drops its drag).
//
// The camera is pinned to the origin at 100% so world units equal screen
// pixels and the geometry is deterministic in jsdom.

import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { flushRaf, hooks, renderApp } from './helpers';

const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });
const shapeButton = () => screen.getByRole('button', { name: 'Shape (S)' });
const connectorButton = () => screen.getByRole('button', { name: 'Connector (L)' });

function pinCamera(): void {
  hooks().setCamera({ x: 0, y: 0, zoom: 1 });
}

/** A press + release with no movement at (x, y) — a click. */
function clickAt(x: number, y: number): void {
  const vp = screen.getByTestId('board-viewport');
  fireEvent.pointerDown(vp, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
  fireEvent.pointerUp(vp, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}

/** A drag from (x1, y1) to (x2, y2). */
function dragTo(x1: number, y1: number, x2: number, y2: number): void {
  const vp = screen.getByTestId('board-viewport');
  fireEvent.pointerDown(vp, { pointerId: 1, clientX: x1, clientY: y1, bubbles: true });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: x2, clientY: y2, bubbles: true });
  fireEvent.pointerUp(vp, { pointerId: 1, clientX: x2, clientY: y2, bubbles: true });
}

function countByType(type: string): number {
  return hooks().getObjects().filter((o) => o.type === type).length;
}

describe('active tool and return to Select (component)', () => {
  it('TC-22: creating with S or L returns to Select; Escape returns to Select and creates nothing', async () => {
    await renderApp();
    pinCamera();

    // --- Shape: S, then create (click) → a shape, and Select is active. ---
    fireEvent.keyDown(window, { key: 's' });
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'false');

    clickAt(120, 120);
    await flushRaf();
    expect(countByType('shape')).toBe(1);
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'false');

    // --- Connector: L, then create (a long drag on empty space). ---
    fireEvent.keyDown(window, { key: 'l' });
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'true');
    dragTo(400, 100, 620, 220);
    await flushRaf();
    expect(countByType('connector')).toBe(1);
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'false');

    // --- Shape: S, then Escape → Select, and nothing was created. ---
    const shapesBefore = countByType('shape');
    fireEvent.keyDown(window, { key: 's' });
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'true');
    // Start an unfinished drag, then Escape: the drag is dropped.
    const vp = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(vp, { pointerId: 1, clientX: 400, clientY: 400, bubbles: true });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 520, clientY: 480, bubbles: true });
    fireEvent.keyDown(window, { key: 'Escape' });
    await flushRaf();
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(countByType('shape')).toBe(shapesBefore);

    // --- Connector: L, then Escape → Select, and nothing was created. ---
    const connectorsBefore = countByType('connector');
    fireEvent.keyDown(window, { key: 'l' });
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    await flushRaf();
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(countByType('connector')).toBe(connectorsBefore);
  });
});
