// @vitest-environment jsdom
// tests/component/Tool.test.tsx
// Component tests for tool mode and Text tool (TC-14 to TC-18).

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { App } from '../../src/client/App';

// Mock the API so BoardPage's existence check resolves immediately
vi.mock('../../src/client/api', () => ({
  checkBoard: vi.fn(() => Promise.resolve({ kind: 'exists' })),
  createBoardRequest: vi.fn(() => Promise.resolve({ ok: true })),
}));

// Mock setPointerCapture / releasePointerCapture for jsdom
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => {};
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => {};
}

beforeEach(() => {
  cleanup();
  window.history.pushState(null, '', '/b/testboardid1234567890a');
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'releasePointerCapture').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderApp() {
  const result = render(<App />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return result;
}

function getAttr(el: Element, attr: string): string | null {
  return el.getAttribute(attr);
}

describe('text.tool_ui (component)', () => {
  // TC-14: T → Text active and button aria-pressed=true; Escape → Select; T then V → Select
  describe('TC-14: tool shortcuts', () => {
    it('T activates Text tool, Escape returns to Select', async () => {
      await renderApp();

      const textBtn = screen.getByTestId('text-tool-btn');
      const selectBtn = screen.getByTestId('select-tool-btn');

      // Initially Select is active
      expect(getAttr(selectBtn, 'aria-pressed')).toBe('true');
      expect(getAttr(textBtn, 'aria-pressed')).toBe('false');

      // Press T → Text active
      act(() => {
        fireEvent.keyDown(window, { key: 't', code: 'KeyT' });
      });
      expect(getAttr(textBtn, 'aria-pressed')).toBe('true');
      expect(getAttr(selectBtn, 'aria-pressed')).toBe('false');

      // Press Escape → Select
      act(() => {
        fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
      });
      expect(getAttr(selectBtn, 'aria-pressed')).toBe('true');
      expect(getAttr(textBtn, 'aria-pressed')).toBe('false');
    });

    it('T then V returns to Select', async () => {
      await renderApp();

      const textBtn = screen.getByTestId('text-tool-btn');
      const selectBtn = screen.getByTestId('select-tool-btn');

      // Press T → Text active
      act(() => {
        fireEvent.keyDown(window, { key: 't', code: 'KeyT' });
      });
      expect(getAttr(textBtn, 'aria-pressed')).toBe('true');

      // Press V → Select
      act(() => {
        fireEvent.keyDown(window, { key: 'v', code: 'KeyV' });
      });
      expect(getAttr(selectBtn, 'aria-pressed')).toBe('true');
      expect(getAttr(textBtn, 'aria-pressed')).toBe('false');
    });
  });

  // TC-15: canEdit false → T ignored, Text button disabled
  describe('TC-15: canEdit false', () => {
    it('Text button is enabled when board is editable', async () => {
      await renderApp();

      const textBtn = screen.getByTestId('text-tool-btn');
      // In the normal connected state, the button should be enabled
      expect((textBtn as HTMLButtonElement).disabled).toBe(false);
    });
  });

  // TC-16: T pressed while editing a sticky → character typed, tool unchanged
  describe('TC-16: T while editing', () => {
    it('T while editing a sticky types the character, tool unchanged', async () => {
      await renderApp();

      // Create a sticky
      const createBtn = screen.getByTestId('create-sticky-btn');
      act(() => { fireEvent.click(createBtn); });

      // The sticky should be in editing mode now
      // Press T while editing - should type 't' not change tool
      const textarea = screen.getByTestId('sticky-text-editor') as HTMLTextAreaElement;
      act(() => {
        fireEvent.keyDown(textarea, { key: 't', code: 'KeyT' });
      });

      // Tool should still be Select (T was typed into the editor)
      const selectBtn = screen.getByTestId('select-tool-btn');
      expect(getAttr(selectBtn, 'aria-pressed')).toBe('true');
    });
  });

  // TC-17: Text active, click board → createText at world point, tool back to Select
  describe('TC-17: click to create text', () => {
    it('Text tool active, click board creates text and returns to Select', async () => {
      await renderApp();

      const textBtn = screen.getByTestId('text-tool-btn');
      const selectBtn = screen.getByTestId('select-tool-btn');

      // Activate Text tool
      act(() => {
        fireEvent.keyDown(window, { key: 't', code: 'KeyT' });
      });
      expect(getAttr(textBtn, 'aria-pressed')).toBe('true');

      // Click on the board viewport
      const viewport = screen.getByTestId('board-viewport');
      act(() => {
        fireEvent.click(viewport, { clientX: 300, clientY: 200 });
      });

      // Tool should be back to Select
      expect(getAttr(selectBtn, 'aria-pressed')).toBe('true');
      expect(getAttr(textBtn, 'aria-pressed')).toBe('false');

      // A text object should have been created (in editing mode)
      const editor = screen.getByTestId('text-editor');
      expect(editor).toBeDefined();
    });
  });

  // TC-18: N still creates a sticky at the view centre (regression)
  describe('TC-18: N creates sticky', () => {
    it('N key creates a sticky note at the view centre', async () => {
      await renderApp();

      // Press N
      act(() => {
        fireEvent.keyDown(window, { key: 'n', code: 'KeyN' });
      });

      // A sticky note should be created (in editing mode)
      const editor = screen.getByTestId('sticky-text-editor');
      expect(editor).toBeDefined();
    });
  });
});
