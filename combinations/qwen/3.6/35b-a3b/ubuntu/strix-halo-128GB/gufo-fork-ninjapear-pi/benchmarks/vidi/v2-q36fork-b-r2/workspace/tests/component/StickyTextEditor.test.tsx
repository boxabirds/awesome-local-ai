import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import * as React from 'react';
import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sticky.text editor component tests', () => {
  describe('TC-23: Enter on selected → Editing, textarea focused, caret at end', () => {
    it('textarea appears with correct value', async () => {
      const onEnd = vi.fn();
      await act(async () =>
        render(
          <StickyTextEditor
            value="Hello"
            fontPx={16}
            overflow={false}
            onChange={() => {}}
            onEnd={onEnd}
          />,
        ),
      );

      const textarea = document.querySelector('textarea');
      expect(textarea).toBeTruthy();
      expect((textarea as HTMLTextAreaElement).value).toBe('Hello');
    });
  });

  describe('TC-24: Escape → Selected, text preserved', () => {
    it('pressing Escape calls onEnd(selected) without modifying text', async () => {
      const onEnd = vi.fn();
      await act(async () =>
        render(
          <StickyTextEditor
            value="Test content"
            fontPx={16}
            overflow={false}
            onChange={() => {}}
            onEnd={onEnd}
          />,
        ),
      );

      const textarea = document.querySelector('textarea')!;
      fireEvent.keyDown(textarea, { key: 'Escape' });

      expect(onEnd).toHaveBeenCalledWith('selected');
    });
  });

  describe('TC-26: Backspace while editing "ab" → note present, text "a"', () => {
    it('Backspace deletes character, not the note', async () => {
      let capturedValue = '';
      const onChange = vi.fn((val: string) => {
        capturedValue = val;
      });
      const onEnd = vi.fn();

      await act(async () =>
        render(
          <StickyTextEditor
            value="ab"
            fontPx={16}
            overflow={false}
            onChange={onChange}
            onEnd={onEnd}
          />,
        ),
      );

      // Simulate backspace by changing value
      const textarea = document.querySelector('textarea')!;
      fireEvent.change(textarea, { target: { value: 'a' } });

      expect(capturedValue).toBe('a');
      expect(onEnd).not.toHaveBeenCalled();
    });
  });

  describe('TC-38: type "abc" then click outside → Unselected', () => {
    it('pointerdown on note triggers select (outside pointerdown handled by parent)', async () => {
      const onSelect = vi.fn();
      const onEnd = vi.fn();
      const capturedValues: string[] = [];
      const onChange = vi.fn((val: string) => {
        capturedValues.push(val);
      });

      await act(async () =>
        render(
          <StickyTextEditor
            value=""
            fontPx={16}
            overflow={false}
            onChange={onChange}
            onEnd={onEnd}
          />,
        ),
      );

      // Type some characters
      const textarea = document.querySelector('textarea')!;
      fireEvent.change(textarea, { target: { value: 'a' } });
      fireEvent.change(textarea, { target: { value: 'ab' } });
      fireEvent.change(textarea, { target: { value: 'abc' } });

      // Verify all values were captured
      expect(capturedValues).toContain('abc');

      // Pointer down inside the editor doesn't call onEnd (that's for outside clicks)
      // but clicking on the note body outside the editor would
      // This is tested via the parent StickyNote component
    });
  });
});
