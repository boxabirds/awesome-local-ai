// Tool mode and Text tool component tests (story 9, TC-14 to TC-18):
// useTool state, Toolbar tool buttons (aria-pressed), click-to-create,
// shortcut behaviour and the load_failed negative.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { snapshot } from '../../src/shared/board-model';
import {
  click,
  dispatch,
  installResizeObserverMock,
  inputValue,
  pointerEvent,
  renderApp,
  viewportEl,
  windowKey,
} from './helpers';
import { boardDoc, setConnection } from './story7-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => cleanup());

const selectBtn = (): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>('button[aria-label="Select (V)"]');
  if (el === null) throw new Error('Select (V) button not rendered');
  return el;
};

const textBtn = (): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>('button[aria-label="Text (T)"]');
  if (el === null) throw new Error('Text (T) button not rendered');
  return el;
};

const stickyBtn = (): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>('button[aria-label="Sticky note"]');
  if (el === null) throw new Error('Sticky note button not rendered');
  return el;
};

function clickViewportAt(container: HTMLElement, x: number, y: number): void {
  const vp = viewportEl(container);
  dispatch(vp, pointerEvent('pointerdown', x, y));
  dispatch(vp, pointerEvent('pointerup', x, y));
}

describe('text.tool_ui', () => {
  it('TC-14 T → Text active and button aria-pressed=true; Escape → Select; T then V → Select', async () => {
    await renderApp();
    windowKey('t');
    expect(textBtn().getAttribute('aria-pressed')).toBe('true');
    expect(selectBtn().getAttribute('aria-pressed')).toBe('false');

    windowKey('Escape');
    expect(selectBtn().getAttribute('aria-pressed')).toBe('true');
    expect(textBtn().getAttribute('aria-pressed')).toBe('false');

    windowKey('t');
    windowKey('v');
    expect(selectBtn().getAttribute('aria-pressed')).toBe('true');
    expect(textBtn().getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-15 canEdit false (load_failed) → T ignored, Text button disabled (negative)', async () => {
    await renderApp();
    setConnection('load_failed');
    expect(textBtn().disabled).toBe(true);
    windowKey('t');
    expect(textBtn().getAttribute('aria-pressed')).toBe('false');
    // Clicking the disabled button does nothing.
    click(textBtn());
    expect(textBtn().getAttribute('aria-pressed')).toBe('false');
    setConnection('online');
    // Recovered: T works again.
    windowKey('t');
    expect(textBtn().getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-16 T pressed while editing a sticky → character typed, tool unchanged (negative)', async () => {
    const { container } = await renderApp();
    // Story 10: the sticky button activates the tool; a click creates the note.
    click(stickyBtn());
    clickViewportAt(container, 640, 400);
    const ta = document.querySelector<HTMLTextAreaElement>('[data-testid="sticky-editor"] textarea');
    if (ta === null) throw new Error('sticky editor not mounted');
    // Focus is inside the editor: typing 't' (input targets the textarea).
    inputValue(ta, 't');
    expect(ta.value).toBe('t');
    // A 't' keydown targeting the editor is not a tool switch.
    dispatch(ta, new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true }));
    expect(selectBtn().getAttribute('aria-pressed')).toBe('true');
    expect(textBtn().getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-17 Text active, click board at (300,200) → createText at the world point; tool back to Select; editor mounted', async () => {
    const { container } = await renderApp();
    windowKey('t');
    clickViewportAt(container, 300, 200);

    const texts = snapshot(boardDoc()).filter((o) => o.type === 'text');
    expect(texts).toHaveLength(1);
    // HOME camera: world (0,0) is screen (640,400) → (300,200) is (-340,-200).
    expect(texts[0].x).toBe(-340);
    expect(texts[0].y).toBe(-200);

    // The tool reverts to Select and the new object is being edited.
    expect(selectBtn().getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-testid="text-editor"]')).not.toBeNull();
  });

  it('TC-18 N still creates a sticky at the view centre (regression of story 2)', async () => {
    await renderApp();
    windowKey('n');
    const stickies = snapshot(boardDoc()).filter((o) => o.type === 'sticky');
    expect(stickies).toHaveLength(1);
    // N is not a tool switch.
    expect(selectBtn().getAttribute('aria-pressed')).toBe('true');
  });
});
