import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import { renderFullApp, hooks, firePointer, pressKey } from './story2';

// Story 5: the board page checks existence before rendering the board.
vi.mock('@/client/api', () => ({
  checkBoard: vi.fn(async () => ({ kind: 'exists' })),
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' })),
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function selectButton(): HTMLButtonElement {
  return screen.getByTestId('select-tool-button') as HTMLButtonElement;
}
function shapeButton(): HTMLButtonElement {
  return screen.getByTestId('shape-tool-button') as HTMLButtonElement;
}
function connectorButton(): HTMLButtonElement {
  return screen.getByTestId('connector-tool-button') as HTMLButtonElement;
}

function objectCount(): number {
  return hooks().getObjects().length;
}

describe('story 10: active tool returns to Select after creation (tools.return_to_select)', () => {
  it('TC-22: S then create, L then create, S then Escape, L then Escape; Escape creates nothing', async () => {
    await renderFullApp();
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');

    // S then create (click, no drag): a shape is created, tool back to Select.
    expect(objectCount()).toBe(0);
    const pressS = () => pressKey(window, 's');
    const pressL = () => pressKey(window, 'l');
    const pressEscape = () => pressKey(window, 'Escape');

    pressS();
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'true');
    let overlay = screen.getByTestId('shape-tool-overlay');
    firePointer(overlay, 'pointerdown', 300, 300);
    firePointer(overlay, 'pointerup', 300, 300);
    expect(objectCount()).toBe(1);
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('shape-tool-overlay')).toBeNull();

    // L then create (free->free drag): a connector is created, tool back to Select.
    pressL();
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'true');
    overlay = screen.getByTestId('connector-tool-overlay');
    // Drag across empty space (well away from the shape created above):
    // a free->free connector.
    firePointer(overlay, 'pointerdown', 100, 100);
    firePointer(overlay, 'pointermove', 800, 600);
    firePointer(overlay, 'pointerup', 800, 600);
    expect(objectCount()).toBe(2);
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('connector-tool-overlay')).toBeNull();

    // S then Escape: back to Select, nothing created.
    pressS();
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'true');
    pressEscape();
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'false');
    expect(objectCount()).toBe(2);

    // L then Escape: back to Select, nothing created.
    pressL();
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'true');
    pressEscape();
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'false');
    expect(objectCount()).toBe(2);
  });
});
