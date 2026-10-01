/**
 * Component tests for text objects: rendering, editing, size changes, width modes,
 * horizontal handles, delete behaviour.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createText, getTextContent, setTextWidthFixed, setTextBox } from '../../src/shared/objects/text';
import { TEXT_LINE_HEIGHT } from '../../src/shared/config';

// Mock createCanvasMeasurer to return a fake
vi.mock('../../src/client/objects/textLayout', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/client/objects/textLayout')>();
  return {
    ...mod,
    createCanvasMeasurer: () => (text: string, fontPx: number) => {
      const perChar = 0.6 * fontPx;
      const lines = text.split('\n');
      let maxW = 0;
      for (const line of lines) maxW = Math.max(maxW, line.length * perChar);
      return { width: maxW, lines: lines.length, height: lines.length * fontPx * TEXT_LINE_HEIGHT };
    },
  };
});

// Mock y-webrtc to prevent actual connections
vi.mock('y-webrtc', () => ({
  WebRTCProvider: class {
    destroyed = false;
    awareness = { setLocalState: vi.fn(), getStates: () => new Map(), on: vi.fn(), off: vi.fn(), destroy: vi.fn(), startPing: vi.fn() };
    on() {} off() {} destroy() {} connect() {} disconnect() {}
    get isConnected() { return false; }
  },
}));

function flush(): void {
  act(() => { vi.advanceTimersByTime(100); });
}

function renderApp(doc: Y.Doc) {
  return render(<App doc={doc} />);
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Text object rendering', () => {
  it('TC-19: renders text with data attributes', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 100, y: 200 }, 'local')!;
    const ytext = getTextContent(doc, id)!;
    ytext.insert(0, 'Hello World');
    // Set explicit box so it differs from initial (60x26)
    doc.transact(() => { setTextBox(doc, id, { width: 132, height: 26 }); }, LOCAL_ORIGIN);

    renderApp(doc);
    flush();

    const obj = document.querySelector('[data-testid="text-object"]');
    expect(obj).not.toBeNull();
    expect(obj).toHaveAttribute('data-world-x', '100');
    expect(obj).toHaveAttribute('data-world-y', '200');
    expect(obj).toHaveAttribute('data-size', 'M');
    expect(obj).toHaveAttribute('data-width-mode', 'auto');
    expect(obj).toHaveAttribute('data-editing', 'false');
  });

  it('TC-20: editing renders the editor with the Y.Text bound', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 50, y: 50 }, 'local')!;
    const ytext = getTextContent(doc, id)!;
    ytext.insert(0, 'Test text');

    renderApp(doc);
    flush();

    // Double-click to start editing
    const obj = document.querySelector('[data-testid="text-object"]')!;
    fireEvent.doubleClick(obj);
    flush();

    // Editor should appear
    expect(screen.getByTestId('text-editor')).toBeInTheDocument();
    const textarea = screen.getByTestId('text-textarea');
    expect(textarea).toHaveValue('Test text');
  });

  it('TC-21: typing writes through to Y.Text immediately', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 50, y: 50 }, 'local')!;

    renderApp(doc);
    flush();

    const obj = document.querySelector('[data-testid="text-object"]')!;
    fireEvent.doubleClick(obj);
    flush();

    const textarea = screen.getByTestId('text-textarea') as HTMLTextAreaElement;
    act(() => {
      textarea.value = 'abc';
      fireEvent.input(textarea);
    });

    const ytext = getTextContent(doc, id)!;
    expect(ytext.toString()).toBe('abc');
  });

  it('TC-22: size button updates data-size', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 50, y: 50 }, 'local')!;
    const ytext = getTextContent(doc, id)!;
    ytext.insert(0, 'Hi');

    renderApp(doc);
    flush();

    // Select the object first via pointer down
    const obj = document.querySelector('[data-testid="text-object"]')!;
    fireEvent.pointerDown(obj, { button: 0, bubbles: true, clientX: 100, clientY: 100 });
    flush();

    // Size toolbar should be visible
    const toolbar = screen.getByTestId('text-toolbar');
    expect(toolbar).toBeInTheDocument();

    // Click XL
    const xlBtn = screen.getByTestId('text-size-XL');
    fireEvent.click(xlBtn);
    flush();

    // Verify size changed
    const objUpdated = document.querySelector('[data-testid="text-object"]')!;
    expect(objUpdated).toHaveAttribute('data-size', 'XL');
  });

  it('TC-23: width-mode=fixed has correct data-width-mode', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'local')!;
    const ytext = getTextContent(doc, id)!;
    ytext.insert(0, 'Fixed width text');
    setTextWidthFixed(doc, id, 200);

    renderApp(doc);
    flush();

    const obj = document.querySelector('[data-testid="text-object"]')!;
    expect(obj).toHaveAttribute('data-width-mode', 'fixed');
  });

  it('TC-24: SelectionOverlay of all-text shows only e and w handles', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 50, y: 50 }, 'local')!;
    const ytext = getTextContent(doc, id)!;
    ytext.insert(0, 'Select me');

    renderApp(doc);
    flush();

    // Select the text object
    const obj = document.querySelector('[data-testid="text-object"]')!;
    fireEvent.pointerDown(obj, { button: 0, bubbles: true, clientX: 100, clientY: 100 });
    flush();

    // Check handles
    const handles = document.querySelectorAll('.selection-handle');
    const handleDirs = Array.from(handles).map((h) => h.getAttribute('aria-label'));
    expect(handleDirs).toContain('Resize right');
    expect(handleDirs).toContain('Resize left');
    expect(handleDirs).not.toContain('Resize top');
    expect(handleDirs).not.toContain('Resize bottom');
  });

  it('TC-25: ending editing with empty text deletes the object', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 50, y: 50 }, 'local')!;
    const ytext = getTextContent(doc, id)!;
    ytext.insert(0, 'Delete me');

    renderApp(doc);
    flush();

    // Start editing
    const obj = document.querySelector('[data-testid="text-object"]')!;
    fireEvent.doubleClick(obj);
    flush();

    // Clear all text
    const textarea = screen.getByTestId('text-textarea') as HTMLTextAreaElement;
    act(() => {
      textarea.value = '';
      fireEvent.input(textarea);
    });

    // End editing via Escape
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Escape' });
    });
    flush();

    // Object should be gone from doc
    expect(getTextContent(doc, id)).toBeUndefined();
  });
});
