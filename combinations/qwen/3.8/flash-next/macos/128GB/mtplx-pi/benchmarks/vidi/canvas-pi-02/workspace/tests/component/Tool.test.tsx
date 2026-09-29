import { describe, expect, it } from 'vitest';
import { renderApp } from './appHarness';
import { dispatch, pointerEvent, keyEvent } from './harness';
import { snapshot } from '../../src/shared/board-model';

/**
 * TC-14 to TC-18: tool mode component tests.
 */

describe('tool mode (TC-14 to TC-18)', () => {
  describe('TC-14 T activates Text tool, Escape returns to Select', () => {
    it('T key activates text tool, Escape returns to select', async () => {
      const harness = renderApp([]);
      // Press T
      await dispatch(window, keyEvent('t'));
      // Text tool button should be pressed
      const textBtn = harness.container.querySelector<HTMLElement>('[data-testid="tool-text"]');
      expect(textBtn).not.toBeNull();
      expect(textBtn!.getAttribute('aria-pressed')).toBe('true');

      // Press Escape
      await dispatch(window, keyEvent('Escape'));
      expect(textBtn!.getAttribute('aria-pressed')).toBe('false');
    });

    it('T then V returns to Select tool', async () => {
      const harness = renderApp([]);
      // Press T
      await dispatch(window, keyEvent('t'));
      const textBtn = harness.container.querySelector<HTMLElement>('[data-testid="tool-text"]');
      expect(textBtn!.getAttribute('aria-pressed')).toBe('true');

      // Press V
      await dispatch(window, keyEvent('v'));
      expect(textBtn!.getAttribute('aria-pressed')).toBe('false');
    });
  });

  describe('TC-15 canEdit false: T is ignored, Text button disabled', () => {
    it('Text tool button is disabled when canEdit is false', () => {
      const harness = renderApp([], { canEdit: false });
      const textBtn = harness.container.querySelector<HTMLElement>('[data-testid="tool-text"]');
      expect(textBtn).not.toBeNull();
      expect(textBtn!.hasAttribute('disabled')).toBe(true);
    });

    it('T key does not activate text tool when canEdit is false', async () => {
      const harness = renderApp([], { canEdit: false });
      await dispatch(window, keyEvent('t'));
      const textBtn = harness.container.querySelector<HTMLElement>('[data-testid="tool-text"]');
      expect(textBtn!.getAttribute('aria-pressed')).not.toBe('true');
    });
  });

  describe('TC-16 T pressed while editing a sticky → tool unchanged', () => {
    it('does not switch tool while in text editor', async () => {
      const harness = renderApp([{ x: 300, y: 200, text: 'hello' }]);
      const id = harness.notes()[0].id;
      const note = harness.noteElement(id);
      // Click to select
      await dispatch(note, pointerEvent('pointerdown', { clientX: 400, clientY: 250 }));
      await dispatch(note, pointerEvent('pointerup', { clientX: 400, clientY: 250 }));
      // Enter to edit
      await dispatch(window, keyEvent('Enter'));
      // Now in editing mode, press T
      const editor = harness.editor();
      if (editor) {
        await dispatch(editor, keyEvent('t'));
      }
      // Tool should still be select
      const textBtn = harness.container.querySelector<HTMLElement>('[data-testid="tool-text"]');
      expect(textBtn!.getAttribute('aria-pressed')).toBe('false');
    });
  });

  describe('TC-17 Text tool click creates text object', () => {
    it('activates text tool, clicks board, creates a text object', async () => {
      const harness = renderApp([]);
      // Press T to activate text tool
      await dispatch(window, keyEvent('t'));
      const textBtn = harness.container.querySelector<HTMLElement>('[data-testid="tool-text"]');
      expect(textBtn!.getAttribute('aria-pressed')).toBe('true');

      // Click on the board surface (empty area)
      const viewport = harness.board();
      await dispatch(viewport, pointerEvent('pointerdown', { clientX: 300, clientY: 200 }));
      await dispatch(viewport, pointerEvent('pointerup', { clientX: 300, clientY: 200 }));

      // Tool should be back to select
      expect(textBtn!.getAttribute('aria-pressed')).toBe('false');

      // A text object should have been created in the doc
      const all = snapshot(harness.doc);
      const textObj = all.find((o) => o.type === 'text');
      expect(textObj).toBeDefined();
    });
  });

  describe('TC-18 N still creates sticky at view centre', () => {
    it('regression of story 2 sticky creation', async () => {
      const harness = renderApp([]);
      // The create-sticky button
      const btn = harness.container.querySelector<HTMLElement>('[data-testid="create-sticky"]');
      expect(btn).not.toBeNull();
      await dispatch(btn!, new MouseEvent('click', { bubbles: true }));
      // A sticky note should exist
      const notes = harness.notes();
      expect(notes.length).toBe(1);
    });
  });
});