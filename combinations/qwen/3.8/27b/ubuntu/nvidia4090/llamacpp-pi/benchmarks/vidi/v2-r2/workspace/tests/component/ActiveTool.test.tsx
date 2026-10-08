/**
 * Story 10, tools.active_tool component test (design TC-22): the S and L
 * shortcuts arm the tools; creating returns to Select; Escape reverts
 * without creating anything.
 *
 * Fixture camera (harness): world (0,0) is at screen (640,400), zoom 1.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { snapshotAll } from '../../src/shared/board-model';
import { renderStickyBoard } from './harness';

afterEach(() => {
  vi.useRealTimers();
});

/** Window-level key press (useActiveTool listens on window keydown). */
function pressKey(key: string): void {
  fireEvent.keyDown(window, { key });
}

describe('story 10: active tool (TC-22)', () => {
  it('S and L return to Select after creating; S/L + Escape create nothing', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();

    // --- S then create: a click makes the default shape, Select is back. ---
    pressKey('s');
    expect(utils.getByTestId('shape-button').getAttribute('aria-pressed')).toBe('true');
    const shapeLayer = utils.getByTestId('shape-tool-layer');
    fireEvent.pointerDown(shapeLayer, { clientX: 640, clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(shapeLayer, { clientX: 640, clientY: 400, pointerId: 1 });

    const afterShape = snapshotAll(utils.doc);
    expect(afterShape).toHaveLength(1);
    expect(afterShape[0].type).toBe('shape');
    expect(utils.getByTestId('select-button').getAttribute('aria-pressed')).toBe('true');
    expect(utils.getByTestId('shape-button').getAttribute('aria-pressed')).toBe('false');

    // --- L then create: drag from the shape into empty space. ---
    pressKey('l');
    expect(utils.getByTestId('connector-button').getAttribute('aria-pressed')).toBe('true');
    const connLayer = utils.getByTestId('connector-tool-layer');
    // The click shape spans world (-80,-80)..(80,80); drag from its centre
    // to world (160,0) — outside it, so the far end is free.
    fireEvent.pointerDown(connLayer, { clientX: 640, clientY: 400, pointerId: 2 });
    fireEvent.pointerMove(connLayer, { clientX: 800, clientY: 400, pointerId: 2 });
    fireEvent.pointerUp(connLayer, { clientX: 800, clientY: 400, pointerId: 2 });

    const afterConn = snapshotAll(utils.doc);
    expect(afterConn).toHaveLength(2);
    expect(afterConn.find((o) => o.type === 'connector')).toBeTruthy();
    expect(utils.getByTestId('select-button').getAttribute('aria-pressed')).toBe('true');
    expect(utils.getByTestId('connector-button').getAttribute('aria-pressed')).toBe('false');

    // --- S then Escape: Select, nothing created. ---
    pressKey('s');
    expect(utils.getByTestId('shape-button').getAttribute('aria-pressed')).toBe('true');
    pressKey('Escape');
    expect(utils.getByTestId('select-button').getAttribute('aria-pressed')).toBe('true');
    expect(snapshotAll(utils.doc)).toHaveLength(2);

    // --- L then Escape: Select, nothing created. ---
    pressKey('l');
    expect(utils.getByTestId('connector-button').getAttribute('aria-pressed')).toBe('true');
    pressKey('Escape');
    expect(utils.getByTestId('select-button').getAttribute('aria-pressed')).toBe('true');
    expect(snapshotAll(utils.doc)).toHaveLength(2);
  });
});
