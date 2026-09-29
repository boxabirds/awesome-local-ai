import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  INITIAL_CAMERA,
  boardDown,
  boardUp,
  flush,
  flushFrames,
  readCamera,
  renderBoard,
  wheel,
  boardElement,
  expectSettled,
} from './harness.js';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint.js';
import { NavigationHint } from '../../src/client/canvas/NavigationHint.js';

const hintVisible = (): boolean =>
  screen.queryByTestId('navigation-hint') !== null;

describe('first-use navigation hint (TC-22)', () => {
  it('is visible on load, hidden by the first camera change and stays hidden', async () => {
    renderBoard();
    expect(hintVisible()).toBe(true);
    expect(screen.getByTestId('navigation-hint').textContent).toBe(NAVIGATION_HINT_TEXT);

    // first navigation: a plain scroll
    await wheel(boardElement(), { deltaY: 100, clientX: 640, clientY: 400 });
    await expectSettled(() => {
      expect(readCamera().y).not.toBe(INITIAL_CAMERA.y);
    });
    expect(hintVisible()).toBe(false);

    // further navigation does not bring it back
    await wheel(boardElement(), { deltaX: 100, clientX: 640, clientY: 400 });
    await wheel(boardElement(), { deltaY: -100, ctrlKey: true, clientX: 640, clientY: 400 });
    expect(hintVisible()).toBe(false);
  });

  it('is hidden by a zoom as well as by a pan', async () => {
    renderBoard();
    await wheel(boardElement(), { deltaY: -100, ctrlKey: true, clientX: 640, clientY: 400 });
    await expectSettled(() => {
      expect(readCamera().zoom).not.toBe(1);
    });
    expect(hintVisible()).toBe(false);
  });

  it('is hidden by a keyboard zoom step', async () => {
    renderBoard();
    const event = new KeyboardEvent('keydown', {
      key: '=',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    await flush();
    expect(hintVisible()).toBe(false);
  });

  it('is rendered bottom-centre with the exact wording', () => {
    render(<NavigationHint visible={true} />);
    const hint = screen.getByTestId('navigation-hint');
    expect(hint.textContent).toBe('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');
  });

  it('renders nothing when not visible', () => {
    render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('is not announced as a live region that would spam the zoom label', () => {
    render(<NavigationHint visible={true} />);
    expect(screen.getByTestId('navigation-hint').getAttribute('role')).toBe('status');
  });
});

describe('negative: no-op navigation keeps the hint (TC-29)', () => {
  it('stays visible after a press without movement', async () => {
    renderBoard();
    await boardDown(300, 200);
    await boardUp(300, 200);
    await flushFrames();

    expect(readCamera()).toEqual(INITIAL_CAMERA);
    expect(hintVisible()).toBe(true);
  });

});
