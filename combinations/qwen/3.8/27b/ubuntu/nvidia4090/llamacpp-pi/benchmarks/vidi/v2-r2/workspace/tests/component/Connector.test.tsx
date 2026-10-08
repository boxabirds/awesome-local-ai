/**
 * Story 10, connector ui-component tests (design TC-18 to TC-21):
 * Connector-tool hover dots, drag-creation with the facing dot highlighted,
 * the Select-tool hit test at the tolerance boundary (50% / 200% zoom), and
 * the re-attach handles (attach / free).
 *
 * Fixture camera (harness): world (0,0) is at screen (640,400), zoom 1
 * (TC-20 jumps the camera through the test-only hook).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import {
  snapshotAll,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { createConnector } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import { renderStickyBoard, type StickyBoardHarnessResult } from './harness';

afterEach(() => {
  vi.useRealTimers();
});

/** Window-level key press (useActiveTool listens on window keydown). */
function pressKey(key: string): void {
  fireEvent.keyDown(window, { key });
}

/** The single connector in the doc (all these tests create exactly one). */
function connectorOf(utils: StickyBoardHarnessResult): ObjectSnapshot {
  const conns = snapshotAll(utils.doc).filter((o) => o.type === 'connector');
  expect(conns).toHaveLength(1);
  return conns[0];
}

describe('story 10: connector tool and object (TC-18 to TC-21)', () => {
  it('TC-18: hovering a shape with the L tool shows four dots at the side midpoints', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    act(() => {
      createShape(
        utils.doc,
        { kind: 'rect', rect: { x: -200, y: -100, width: 200, height: 100 }, at: { x: -100, y: -50 } },
        'test',
      );
    });
    pressKey('l');
    const layer = utils.getByTestId('connector-tool-layer');

    // Hover over the shape (world (-80,-40) is inside its box).
    fireEvent.pointerMove(layer, { clientX: 560, clientY: 360, pointerId: 1 });

    // Four dots at the side midpoints (screen coords at the fixture camera).
    expect(Number(utils.getByTestId('connector-dot-top').getAttribute('cx'))).toBe(540);
    expect(Number(utils.getByTestId('connector-dot-top').getAttribute('cy'))).toBe(300);
    expect(Number(utils.getByTestId('connector-dot-right').getAttribute('cx'))).toBe(640);
    expect(Number(utils.getByTestId('connector-dot-right').getAttribute('cy'))).toBe(350);
    expect(Number(utils.getByTestId('connector-dot-bottom').getAttribute('cx'))).toBe(540);
    expect(Number(utils.getByTestId('connector-dot-bottom').getAttribute('cy'))).toBe(400);
    expect(Number(utils.getByTestId('connector-dot-left').getAttribute('cx'))).toBe(440);
    expect(Number(utils.getByTestId('connector-dot-left').getAttribute('cy'))).toBe(350);
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      expect(utils.getByTestId(`connector-dot-${side}`).getAttribute('data-highlighted')).toBe(
        'false',
      );
    }
  });

  it("TC-19: dragging from A over B highlights B's facing dot; release creates an attached connector", () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    let aId: string | null = null;
    let bId: string | null = null;
    act(() => {
      aId = createShape(
        utils.doc,
        { kind: 'rect', rect: { x: -200, y: -100, width: 200, height: 100 }, at: { x: -100, y: -50 } },
        'test',
      );
      bId = createShape(
        utils.doc,
        { kind: 'rect', rect: { x: 100, y: -100, width: 200, height: 100 }, at: { x: 200, y: -50 } },
        'test',
      );
    });
    pressKey('l');
    const layer = utils.getByTestId('connector-tool-layer');

    // Drag from A's centre (world (-100,-50)) to a point inside B (world (120,-50)).
    fireEvent.pointerDown(layer, { clientX: 540, clientY: 350, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: 760, clientY: 350, pointerId: 1 });

    // B's facing (left) dot is highlighted; the others are not.
    expect(utils.getByTestId('connector-dot-left').getAttribute('data-highlighted')).toBe('true');
    expect(utils.getByTestId('connector-dot-top').getAttribute('data-highlighted')).toBe('false');
    expect(utils.getByTestId('connector-dot-right').getAttribute('data-highlighted')).toBe('false');
    expect(utils.getByTestId('connector-dot-bottom').getAttribute('data-highlighted')).toBe('false');

    fireEvent.pointerUp(layer, { clientX: 760, clientY: 350, pointerId: 1 });

    const c = connectorOf(utils);
    expect(c.from).toEqual({ kind: 'attached', objectId: aId, fallback: { x: 0, y: -50 } });
    expect(c.to).toEqual({ kind: 'attached', objectId: bId, fallback: { x: 100, y: -50 } });
    // The tool reverted to Select.
    expect(utils.getByTestId('select-button').getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-20: a Select click 5 screen-px from an arrow selects it, 7 px does not (50% and 200% zoom)', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    act(() => {
      const aId = createShape(
        utils.doc,
        { kind: 'rect', rect: { x: -200, y: -50, width: 200, height: 100 }, at: { x: -100, y: 0 } },
        'test',
      );
      const bId = createShape(
        utils.doc,
        { kind: 'rect', rect: { x: 200, y: -50, width: 200, height: 100 }, at: { x: 300, y: 0 } },
        'test',
      );
      // The connector's line is world (0,0) → (200,0).
      createConnector(
        utils.doc,
        {
          from: { kind: 'attached', objectId: aId!, fallback: { x: 0, y: 0 } },
          to: { kind: 'attached', objectId: bId!, fallback: { x: 200, y: 0 } },
        },
        'test',
      );
    });
    expect(utils.getByTestId('connector-object')).toBeTruthy();

    const clickAt = (x: number, y: number): void => {
      const vp = utils.getByTestId('board-viewport');
      fireEvent.pointerDown(vp, { clientX: x, clientY: y, pointerId: 1 });
      fireEvent.pointerUp(vp, { clientX: x, clientY: y, pointerId: 1 });
    };
    const isSelected = (): string | null =>
      utils.getByTestId('connector-object').getAttribute('data-selected');
    const jumpCamera = (cam: { x: number; y: number; zoom: number }): void => {
      act(() => {
        window.__vidi6?.setCamera(cam);
        // The camera update is rAF-coalesced; flush it (fake timers).
        vi.advanceTimersByTime(16);
      });
    };

    // Camera A (50%): the line's midpoint world (100,0) sits at screen (370,200).
    jumpCamera({ x: -640, y: -400, zoom: 0.5 });
    // 5 screen-px below the line: world (100,10) — inside the 12-unit tolerance.
    clickAt(370, 205);
    expect(isSelected()).toBe('true');
    // 7 screen-px: world (100,14) — outside; the click pans and clears.
    clickAt(370, 207);
    expect(isSelected()).toBe('false');

    // Camera B (200%): the midpoint sits at screen (640,400).
    jumpCamera({ x: -220, y: -200, zoom: 2 });
    // 5 screen-px: world (100,2.5) — inside the 3-unit tolerance.
    clickAt(640, 405);
    expect(isSelected()).toBe('true');
    // 7 screen-px: world (100,3.5) — outside.
    clickAt(640, 407);
    expect(isSelected()).toBe('false');
  });

  it('TC-21: dragging the end handle onto C attaches it; onto empty space it frees at the release point', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    let aId = '';
    let bId = '';
    let cId = '';
    act(() => {
      aId = createShape(
        utils.doc,
        { kind: 'rect', rect: { x: -200, y: -50, width: 200, height: 100 }, at: { x: -100, y: 0 } },
        'test',
      )!;
      bId = createShape(
        utils.doc,
        { kind: 'rect', rect: { x: 200, y: -50, width: 200, height: 100 }, at: { x: 300, y: 0 } },
        'test',
      )!;
      cId = createShape(
        utils.doc,
        { kind: 'ellipse', rect: { x: 200, y: 150, width: 200, height: 100 }, at: { x: 300, y: 200 } },
        'test',
      )!;
      const connId = createConnector(
        utils.doc,
        {
          from: { kind: 'attached', objectId: aId, fallback: { x: 0, y: 0 } },
          to: { kind: 'attached', objectId: bId, fallback: { x: 200, y: 0 } },
        },
        'test',
      );
      expect(connId).not.toBeNull();
    });

    // Select the connector by clicking its line at world (100,0).
    const vp = utils.getByTestId('board-viewport');
    fireEvent.pointerDown(vp, { clientX: 740, clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(vp, { clientX: 740, clientY: 400, pointerId: 1 });
    expect(utils.getByTestId('connector-object').getAttribute('data-selected')).toBe('true');

    // The "to" handle sits at B's left anchor (200,0) → screen (840,400).
    // Drag it onto C's centre (300,200) → screen (940,600).
    fireEvent.pointerDown(utils.getByTestId('connector-handle-to'), {
      clientX: 840,
      clientY: 400,
      pointerId: 2,
    });
    fireEvent.pointerUp(window, { clientX: 940, clientY: 600, pointerId: 2 });

    // Attached to C, on the side facing the other endpoint (top).
    expect(connectorOf(utils).to).toEqual({
      kind: 'attached',
      objectId: cId,
      fallback: { x: 300, y: 150 },
    });

    // Now drag the handle onto empty space (world (-440,200) → screen (200,600)).
    fireEvent.pointerDown(utils.getByTestId('connector-handle-to'), {
      clientX: 940,
      clientY: 550,
      pointerId: 3,
    });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 600, pointerId: 3 });

    // Free at the release point.
    expect(connectorOf(utils).to).toEqual({ kind: 'free', x: -440, y: 200 });
  });
});
