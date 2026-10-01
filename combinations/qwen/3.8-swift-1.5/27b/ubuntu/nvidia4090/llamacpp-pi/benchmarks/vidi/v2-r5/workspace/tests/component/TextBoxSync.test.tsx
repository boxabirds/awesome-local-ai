// @vitest-environment jsdom
// tests/component/TextBoxSync.test.tsx
// Component tests for useTextBoxSync: local-only write rule (TC-12, TC-13).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { renderHook, act } from '@testing-library/react';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import * as textModule from '../../src/shared/objects/text';
import { createText, getTextContent, setTextWidthFixed } from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import { TEXT_SIZES, TEXT_LINE_HEIGHT } from '../../src/shared/config';
import type { Measurer } from '../../src/client/objects/textLayout';

// Fake measurer: 10 units per character
const fakeMeasure: Measurer = (text: string) => {
  return text.replace(/\n/g, '').length * 10;
};

describe('TextBoxSync (component)', () => {
  let doc: Y.Doc;
  let textId: string;
  let setTextBoxSpy: any;

  beforeEach(() => {
    doc = new Y.Doc();
    textId = createText(doc, { x: 0, y: 0 }, 'test')!;

    // Spy on setTextBox
    setTextBoxSpy = vi.spyOn(textModule, 'setTextBox');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TC-12: remote text change → no write; local change → one write
  describe('TC-12: local-only write rule', () => {
    it('remote text change produces zero setTextBox writes', () => {
      renderHook(() => useTextBoxSync(doc, textId, fakeMeasure));

      // Simulate a remote change by directly modifying the Y.Text
      act(() => {
        const ytext = getTextContent(doc, textId)!;
        ytext.insert(0, 'hello');
      });

      // No remeasureAfterLocalChange was called, so no writes
      expect(setTextBoxSpy).not.toHaveBeenCalled();
    });

    it('local text change produces exactly one setTextBox write', () => {
      const { result } = renderHook(() => useTextBoxSync(doc, textId, fakeMeasure));

      act(() => {
        const ytext = getTextContent(doc, textId)!;
        applyTextDiff(ytext, 'hello world');
        result.current.remeasureAfterLocalChange();
      });

      expect(setTextBoxSpy).toHaveBeenCalledTimes(1);
      // "hello world" = 11 chars × 10 = 110 units wide
      expect(setTextBoxSpy).toHaveBeenCalledWith(doc, textId, {
        width: 110,
        height: TEXT_SIZES.M * TEXT_LINE_HEIGHT,
      });
    });
  });

  // TC-13: local size change whose remeasured box equals stored box → no write
  describe('TC-13: no redundant writes', () => {
    it('does not write when remeasured box equals stored box', () => {
      const { result } = renderHook(() => useTextBoxSync(doc, textId, fakeMeasure));

      // First, set some text and measure
      act(() => {
        const ytext = getTextContent(doc, textId)!;
        applyTextDiff(ytext, 'hello');
        result.current.remeasureAfterLocalChange();
      });

      expect(setTextBoxSpy).toHaveBeenCalledTimes(1);
      setTextBoxSpy.mockClear();

      // Call remeasure again with no changes → no write
      act(() => {
        result.current.remeasureAfterLocalChange();
      });

      expect(setTextBoxSpy).not.toHaveBeenCalled();
    });
  });

  // Auto → fixed transition after a width drag rewraps and writes new height once
  describe('auto to fixed transition', () => {
    it('writes new height once after switching to fixed width', () => {
      const { result } = renderHook(() => useTextBoxSync(doc, textId, fakeMeasure));

      // Set some text
      act(() => {
        const ytext = getTextContent(doc, textId)!;
        applyTextDiff(ytext, 'hello world');
        result.current.remeasureAfterLocalChange();
      });

      expect(setTextBoxSpy).toHaveBeenCalledTimes(1);
      setTextBoxSpy.mockClear();

      // Switch to fixed width (simulating handle drag)
      act(() => {
        setTextWidthFixed(doc, textId, 50);
        result.current.remeasureAfterLocalChange();
      });

      // Should write once with the new fixed width and recalculated height
      expect(setTextBoxSpy).toHaveBeenCalledTimes(1);
      const call = (setTextBoxSpy as any).mock.calls[0];
      expect(call[2].width).toBe(50);
      // "hello world" at 50 units: "hello" = 50 fits, "world" = 50 fits
      // So 2 lines
      expect(call[2].height).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });
  });
});
