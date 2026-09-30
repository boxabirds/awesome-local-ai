// Copyright 2026 Board Room contributors. All rights reserved.
//
// Two people in one note's text. Component-level counterpart of the e2e case
// with the same name: the shared text changes underneath an open editor, and
// neither side's characters may disappear.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';

const flush = (): void => {
  act(() => {
    vi.advanceTimersByTime(64);
  });
};

const editor = (): HTMLTextAreaElement =>
  screen.getByTestId('sticky-note-text') as HTMLTextAreaElement;

/** Type a whole value into the open editor, the way a keyboard would. */
const typeInto = (value: string): void => {
  fireEvent.input(editor(), { target: { value } });
  flush();
};

const TEXT_NAME = 'objects';

describe('two people in one note (remote text)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("shows the other person's typing in the open editor", () => {
    const doc = new Y.Doc();
    const ytext = doc.getText(TEXT_NAME);
    doc.transact(() => {
      ytext.insert(0, 'go:');
    });

    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));

    render(<StickyTextEditor ytext={ytext} fontPx={16} onEnd={() => undefined} />);
    expect(editor().value).toBe('go:');

    // The other person types, over the network: an update from their document.
    other.transact(() => {
      other.getText(TEXT_NAME).insert(3, 'bbbb');
    });
    act(() => {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    });

    // Their characters are on this screen now, in the very textarea being typed in.
    expect(editor().value).toBe('go:bbbb');
  });

  it("keeps both people's characters when we type on and merge", () => {
    const doc = new Y.Doc();
    const ytext = doc.getText(TEXT_NAME);
    doc.transact(() => {
      ytext.insert(0, 'go:');
    });
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));

    render(<StickyTextEditor ytext={ytext} fontPx={16} onEnd={() => undefined} />);

    other.transact(() => {
      other.getText(TEXT_NAME).insert(3, 'bbbb');
    });
    act(() => {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    });

    // This screen goes on typing. The keystroke is applied to the text the
    // editor now shows — theirs included — and not to what it was beforehand.
    typeInto('go:bbbbcccc');

    expect(editor().value).toBe('go:bbbbcccc');
    expect(ytext.toString()).toBe('go:bbbbcccc');

    // And the two documents land on the same string: nobody's characters lost.
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    expect(other.getText(TEXT_NAME).toString()).toBe('go:bbbbcccc');
  });

  it('does not write the old local value over a change that arrived mid-edit', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText(TEXT_NAME);
    const other = new Y.Doc();

    render(<StickyTextEditor ytext={ytext} fontPx={16} onEnd={() => undefined} />);

    // Both start from nothing; the other person's text lands first.
    other.transact(() => {
      other.getText(TEXT_NAME).insert(0, 'theirs');
    });
    act(() => {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    });
    expect(ytext.toString()).toBe('theirs');

    // Leaving the editor (a blur) flushes what the textarea holds. That flush is
    // the same string, so it must not become a rewrite that drops their text.
    fireEvent.blur(editor());
    flush();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    expect(other.getText(TEXT_NAME).toString()).toBe('theirs');
  });
});
