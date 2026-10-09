/**
 * Story 10, task 14: the active tool (TC-22).
 *
 * The active tool is one piece of state with three ways in — the toolbar, the shortcut and the
 * board itself taking it back after a creation — and one rule that matters more than the rest:
 * after a shape or an arrow has been put down, the tool in hand is Select again. Everything else
 * in this file is the negative half of that: taking the tool away by hand, in the middle of a
 * drag, which must not put anything on the board.
 */
import { describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import {
  flushFrames,
  pressKey,
  renderBoard,
} from './fixtures/board';
import {
  B_LAYOUT,
  centreOf,
  clickConnectorTool,
  clickShapeTool,
  connectorToolSurface,
  connectorToolSurfaceOrNull,
  dragOnSurface,
  pressToolKey,
  screenOf,
  seedShape,
  shapeToolSurface,
  shapeToolSurfaceOrNull,
  shapesInDoc,
  toolPressed,
  waitForConnectors,
  waitForShapes,
  connectorsInDoc,
} from './fixtures/shapes';

/** The three tool buttons, as the toolbar presses them. */
function pressed(): { select: boolean; shape: boolean; connector: boolean } {
  return {
    select: toolPressed('[data-testid="tool-select"]'),
    shape: toolPressed('[data-testid="tool-shape"]'),
    connector: toolPressed('[data-testid="tool-connector"]'),
  };
}

describe('the tool going back to Select after a creation (TC-22)', () => {
  it('TC-22: a shape created with S, then an arrow created with L, both leave Select active', async () => {
    await renderBoard();
    expect(pressed()).toEqual({ select: true, shape: false, connector: false });

    // S, and one click on empty board.
    await pressToolKey('s');
    expect(pressed().shape).toBe(true);
    // The surface only exists while the tool is up.
    expect(shapeToolSurfaceOrNull()).not.toBeNull();
    await dragOnSurface(shapeToolSurface(), { x: 400, y: 300 }, { x: 560, y: 420 });
    await waitForShapes(1);
    expect(pressed()).toEqual({ select: true, shape: false, connector: false });
    expect(shapeToolSurfaceOrNull()).toBeNull();

    // L, and one drag from a shape to another one.
    await pressToolKey('l');
    expect(pressed().connector).toBe(true);
    expect(connectorToolSurfaceOrNull()).not.toBeNull();
    const [first] = shapesInDoc();
    const second = seedShape(B_LAYOUT.second);
    await dragOnSurface(
      connectorToolSurface(),
      screenOf(centreOf({ x: first.x, y: first.y, width: first.width, height: first.height })),
      screenOf(centreOf(B_LAYOUT.second)),
    );
    await waitForConnectors(1);
    expect(pressed()).toEqual({ select: true, shape: false, connector: false });
    expect(connectorToolSurfaceOrNull()).toBeNull();
    expect(second).toBeTruthy();
  });

  it('Escape puts Select back from either tool and writes nothing', async () => {
    await renderBoard();

    await pressToolKey('s');
    pressKey('Escape');
    await flushFrames();
    expect(pressed()).toEqual({ select: true, shape: false, connector: false });
    expect(shapeToolSurfaceOrNull()).toBeNull();

    await pressToolKey('l');
    pressKey('Escape');
    await flushFrames();
    expect(pressed()).toEqual({ select: true, shape: false, connector: false });
    expect(connectorToolSurfaceOrNull()).toBeNull();

    // And nothing was written by either of those two tool trips.
    expect(shapesInDoc()).toHaveLength(0);
    expect(connectorsInDoc()).toHaveLength(0);
  });

  it('Escape in the middle of a drag throws the drag away: no shape, Select active', async () => {
    await renderBoard();
    await clickShapeTool();
    const surface = shapeToolSurface();
    act(() => {
      surface.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          clientX: 400,
          clientY: 300,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 1,
        }),
      );
      surface.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          clientX: 560,
          clientY: 420,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 1,
        }),
      );
    });
    await flushFrames();
    expect(document.querySelector('[data-testid="shape-preview"]')).not.toBeNull();

    // The tool is taken away mid-drag, so the component holding the drag goes with it.
    pressKey('Escape');
    await flushFrames();
    expect(shapesInDoc()).toHaveLength(0);
    expect(pressed().select).toBe(true);
  });

  it('V puts Select back from either tool, and the shape and arrow shortcuts are S and L', async () => {
    await renderBoard();
    await clickShapeTool();
    pressKey('v');
    await flushFrames();
    expect(pressed().select).toBe(true);

    await clickConnectorTool();
    pressKey('v');
    await flushFrames();
    expect(pressed().select).toBe(true);
    // A pointer tool, so the board's own shortcuts still work and no surface is left mounted.
    expect(connectorToolSurfaceOrNull()).toBeNull();
    // The keys themselves.
    await pressToolKey('s');
    expect(pressed().shape).toBe(true);
    await pressToolKey('l');
    expect(pressed().connector).toBe(true);
    await pressToolKey('v');
    expect(pressed().select).toBe(true);
    void dragOnSurface;
    void connectorToolSurface;
    void shapeToolSurface;
  });
});
