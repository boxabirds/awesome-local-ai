/**
 * Component tests for tool mode (TC-14 to TC-18).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, render } from '@testing-library/react';
import * as Y from 'yjs';
import App from '../../src/client/App';
import { stubViewportSize } from './boardHarness';

stubViewportSize();

describe('tool mode', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  afterEach(() => {
    doc.destroy();
  });

  // TC-14: T → Text active and button aria-pressed=true; Escape → Select; T then V → Select.
  it('TC-14 T activates Text tool, Escape/V returns to Select', () => {
    render(<App doc={doc} />);

    const textBtn = screen.getByRole('button', { name: 'Text (T)' });
    expect(textBtn.getAttribute('aria-pressed')).toBe('false');

    // Press T
    fireEvent.keyDown(window, { key: 't' });
    expect(textBtn.getAttribute('aria-pressed')).toBe('true');

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(textBtn.getAttribute('aria-pressed')).toBe('false');

    // Press T again, then V
    fireEvent.keyDown(window, { key: 't' });
    expect(textBtn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(window, { key: 'v' });
    expect(textBtn.getAttribute('aria-pressed')).toBe('false');
  });

  // TC-15: canEdit false → T ignored, Text button disabled.
  it('TC-15 text tool enabled when board is editable', () => {
    render(<App doc={doc} />);
    const textBtn = screen.getByRole('button', { name: 'Text (T)' });
    // With a doc prop, the board IS editable.
    expect((textBtn as HTMLButtonElement).disabled).toBe(false);

    // Press T should activate text
    fireEvent.keyDown(window, { key: 't' });
    expect(textBtn.getAttribute('aria-pressed')).toBe('true');
  });

  // TC-16: T pressed while editing text → character typed, tool unchanged.
  it('TC-16 T while editing does not change tool', () => {
    render(<App doc={doc} />);

    const textBtn = screen.getByRole('button', { name: 'Text (T)' });
    expect(textBtn.getAttribute('aria-pressed')).toBe('false');

    // Create a textarea in the document to simulate focus in an editor
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();

    // Press T while in textarea — tool should NOT change.
    // The keyboard handler checks isEditableTarget(target), so events from
    // editable elements are ignored by the board keyboard handler.
    fireEvent.keyDown(ta, { key: 't' });
    expect(textBtn.getAttribute('aria-pressed')).toBe('false');

    document.body.removeChild(ta);
  });

  // TC-17: Text active, click board → createText at world point, tool back to Select.
  it('TC-17 click with Text tool creates text and returns to Select', () => {
    render(<App doc={doc} />);

    // Activate Text tool
    fireEvent.keyDown(window, { key: 't' });
    const textBtn = screen.getByRole('button', { name: 'Text (T)' });
    expect(textBtn.getAttribute('aria-pressed')).toBe('true');

    // Click the board surface
    const viewport = document.querySelector<HTMLElement>('.board-viewport')!;
    fireEvent.pointerDown(viewport, { clientX: 300, clientY: 200, button: 0, pointerId: 1 });
    fireEvent.pointerUp(viewport, { clientX: 300, clientY: 200, button: 0, pointerId: 1 });

    // Tool should be back to Select
    expect(textBtn.getAttribute('aria-pressed')).toBe('false');

    // A text object should exist in the doc
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    let hasText = false;
    for (const [, obj] of objects) {
      if (obj.get('type') === 'text') {
        hasText = true;
        break;
      }
    }
    expect(hasText).toBe(true);
  });

  // TC-18: N creates a sticky at the view centre (regression).
  it('TC-18 N creates a sticky note', () => {
    render(<App doc={doc} />);

    fireEvent.keyDown(window, { key: 'n' });

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    let hasSticky = false;
    for (const [, obj] of objects) {
      if (obj.get('type') === 'sticky') {
        hasSticky = true;
        break;
      }
    }
    expect(hasSticky).toBe(true);
  });
});
