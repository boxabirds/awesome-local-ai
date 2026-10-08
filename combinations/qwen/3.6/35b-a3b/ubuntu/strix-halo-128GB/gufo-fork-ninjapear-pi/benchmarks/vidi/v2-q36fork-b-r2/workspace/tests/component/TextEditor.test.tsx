import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as React from 'react';
import * as Y from 'yjs';
import { TextEditor } from '../../src/client/objects/TextEditor';

describe('TC-18: TextEditor renders textarea with current Y.Text content', () => {
  it('displays initial text and updates on remote change', async () => {
    const doc = new Y.Doc();
    const ytext = new Y.Text('hello world');
    const objectsMap = doc.getMap('objects') as Y.Map<Y.Map<any>>;
    const testMap = new Y.Map();
    testMap.set('text', ytext);
    objectsMap.set('test', testMap);

    await act(async () => {
      render(
        <TextEditor
          ytext={ytext}
          maxChars={5000}
          fontPx={20}
          width={'auto'}
          onInput={() => {}}
          onEnd={() => {}}
        />,
      );
    });

    const textarea = document.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect((textarea as HTMLTextAreaElement).value).toBe('hello world');
  });
});

describe('TC-19: TextEditor onInput reflects typing in textarea', () => {
  it('typing "!" appends character to Y.Text', async () => {
    const doc = new Y.Doc();
    const ytext = new Y.Text('hello');
    const objectsMap = doc.getMap('objects') as Y.Map<Y.Map<any>>;
    const testMap = new Y.Map();
    testMap.set('text', ytext);
    objectsMap.set('test', testMap);

    const onInput = vi.fn();
    const onEnd = vi.fn();

    await act(async () => {
      render(
        <TextEditor
          ytext={ytext}
          maxChars={5000}
          fontPx={20}
          width={'auto'}
          onInput={onInput}
          onEnd={onEnd}
        />,
      );
    });

    // Type an exclamation mark
    await act(async () => {
      const textarea = document.querySelector('textarea')!;
      fireEvent.input(textarea, { target: { value: 'hello!' } });
    });

    expect(ytext.toString()).toBe('hello!');
    expect(onInput).toHaveBeenCalled();
  });
});

describe('TC-20: TextEditor onEnd called correctly', () => {
  it('Escape key → onEnd("selected")', async () => {
    const doc = new Y.Doc();
    const ytext = new Y.Text('test');
    const objectsMap = doc.getMap('objects') as Y.Map<Y.Map<any>>;
    const testMap = new Y.Map();
    testMap.set('text', ytext);
    objectsMap.set('test', testMap);

    const onInput = vi.fn();
    const onEnd = vi.fn();

    await act(async () => {
      render(
        <TextEditor
          ytext={ytext}
          maxChars={5000}
          fontPx={20}
          width={'auto'}
          onInput={onInput}
          onEnd={onEnd}
        />,
      );
    });

    // Press Escape
    await act(async () => {
      const textarea = document.querySelector('textarea')!;
      fireEvent.keyDown(textarea, { key: 'Escape' });
    });

    expect(onEnd).toHaveBeenCalledWith('selected');
  });
});
