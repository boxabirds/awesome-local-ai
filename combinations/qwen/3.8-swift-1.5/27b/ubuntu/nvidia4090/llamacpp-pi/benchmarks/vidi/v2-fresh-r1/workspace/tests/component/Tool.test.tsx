// Component tests for the tool mode and Text tool (text.tool_ui contract).
// TC-14 to TC-18.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { BoardHarness, makeDoc } from './board-harness';
import '../fixtures/testbox';

function renderBoard(canEdit = true) {
  const doc = makeDoc();
  initDoc(doc);
  render(<BoardHarness doc={doc} canEdit={canEdit} withToolbar />);
  return { doc };
}

function textObjectIds(doc: Y.Doc): string[] {
  return snapshot(doc).filter((o) => o.type === 'text').map((o) => o.id);
}

function stickyObjectIds(doc: Y.Doc): string[] {
  return snapshot(doc).filter((o) => o.type === 'sticky').map((o) => o.id);
}

afterEach(cleanup);

describe('tool mode (story 9)', () => {
  // TC-14: T → Text active, button pressed; Escape → Select; V → Select.
  test('TC-14 T activates Text; Escape and V return to Select', () => {
    renderBoard();

    fireEvent.keyDown(window, { key: 't' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('text');
    expect(screen.getByTestId('text-tool-btn').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('select-tool-btn').getAttribute('aria-pressed')).toBe('false');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('select');
    expect(screen.getByTestId('select-tool-btn').getAttribute('aria-pressed')).toBe('true');

    // T again, then V.
    fireEvent.keyDown(window, { key: 't' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('text');
    fireEvent.keyDown(window, { key: 'v' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('select');
  });

  // TC-15: load failed → T ignored, Text button disabled (negative).
  test('TC-15 Text tool is unavailable when the board is not editable', () => {
    renderBoard(false);

    const textBtn = screen.getByTestId('text-tool-btn');
    expect(textBtn).toBeDisabled();

    fireEvent.keyDown(window, { key: 't' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('select');

    // Clicking the (disabled) Text button does nothing.
    fireEvent.click(textBtn);
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('select');
  });

  // TC-15b: an active Text tool reverts to Select when editing is lost.
  test('active Text reverts to Select when the board becomes read-only', () => {
    const doc = makeDoc();
    initDoc(doc);
    const { rerender } = render(<BoardHarness doc={doc} canEdit={true} withToolbar />);

    fireEvent.keyDown(window, { key: 't' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('text');

    rerender(<BoardHarness doc={doc} canEdit={false} withToolbar />);
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('select');
  });

  // TC-16: T while editing a note is ignored (types 't' in the editor).
  test('TC-16 T is inert while a text editor is open', () => {
    const doc = makeDoc();
    initDoc(doc);
    render(<BoardHarness doc={doc} withToolbar />);

    // Create a sticky and enter its editor.
    const id = snapshot(doc).length; // 0 before
    fireEvent.keyDown(window, { key: 'n' });
    expect(stickyObjectIds(doc)).toHaveLength(1);
    void id;
    const stickyId = stickyObjectIds(doc)[0];
    const stickyEl = screen.getByTestId('sticky-note');
    fireEvent.dblClick(stickyEl);
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe(stickyId);

    // T now types into the editor; the tool must not change.
    fireEvent.keyDown(window, { key: 't' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('select');
  });

  // TC-17: Text active, click board → createText; tool back to Select; editing.
  test('TC-17 clicking the board with Text active creates a text and starts editing', () => {
    const { doc } = renderBoard();

    fireEvent.keyDown(window, { key: 't' });
    fireEvent.click(screen.getByTestId('board-viewport'));

    const textIds = textObjectIds(doc);
    expect(textIds).toHaveLength(1);
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('select');
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe(textIds[0]);
  });

  // TC-18: N still creates a sticky at the view centre (regression).
  test('TC-18 N creates a sticky at the view centre', () => {
    const { doc } = renderBoard();

    fireEvent.keyDown(window, { key: 'n' });

    expect(stickyObjectIds(doc)).toHaveLength(1);
    expect(textObjectIds(doc)).toHaveLength(0);
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe(stickyObjectIds(doc)[0]);
  });

  // Double-click on empty space does NOT create a sticky while Text is active.
  test('double-click is inert for stickies while Text is active', () => {
    const { doc } = renderBoard();

    fireEvent.keyDown(window, { key: 't' });
    fireEvent.dblClick(screen.getByTestId('board-viewport'));
    expect(stickyObjectIds(doc)).toHaveLength(0);
  });
});
