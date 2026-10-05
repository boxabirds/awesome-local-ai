import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, getViewport, windowKeyDown, pointerEvent } from './appHarness';
import { getTextContent } from '../../src/shared/objects/text';
import { DEFAULT_TEXT_SIZE } from '../../src/shared/config';

afterEach(cleanup);

function textObjects(doc: import('yjs').Doc): string[] {
  const ids: string[] = [];
  doc.getMap('objects').forEach((obj, id) => {
    if ((obj as import('yjs').Map<unknown>).get('type') === 'text') ids.push(id as string);
  });
  return ids;
}

function textObject(doc: import('yjs').Doc, id: string): import('yjs').Map<unknown> {
  const obj = doc.getMap('objects').get(id);
  if (!obj) throw new Error(`text ${id} not found`);
  return obj as import('yjs').Map<unknown>;
}

describe('text.tool (ui-component)', () => {
  it('TC-14: T → Text active and button pressed; Escape → Select; T then V → Select', async () => {
    await renderApp();
    const textButton = screen.getByLabelText('Text (T)');
    const selectButton = screen.getByLabelText('Select (V)');

    expect(textButton.getAttribute('aria-pressed')).toBe('false');
    expect(selectButton.getAttribute('aria-pressed')).toBe('true');

    act(() => windowKeyDown('t'));
    expect(textButton.getAttribute('aria-pressed')).toBe('true');
    expect(selectButton.getAttribute('aria-pressed')).toBe('false');

    // Escape leaves the text tool
    act(() => windowKeyDown('Escape'));
    expect(selectButton.getAttribute('aria-pressed')).toBe('true');
    expect(textButton.getAttribute('aria-pressed')).toBe('false');

    // T then V → Select
    act(() => windowKeyDown('t'));
    expect(textButton.getAttribute('aria-pressed')).toBe('true');
    act(() => windowKeyDown('v'));
    expect(selectButton.getAttribute('aria-pressed')).toBe('true');
    expect(textButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-15: viewer (canEdit=false) — T is ignored and the Text button is disabled', async () => {
    await renderApp({ canEdit: false });
    const textButton = screen.getByLabelText('Text (T)') as HTMLButtonElement;
    const selectButton = screen.getByLabelText('Select (V)');

    expect(textButton.disabled).toBe(true);
    expect(textButton.getAttribute('aria-pressed')).toBe('false');

    act(() => windowKeyDown('t'));
    expect(textButton.getAttribute('aria-pressed')).toBe('false');
    expect(selectButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-16: T while editing a note types "t" (the tool does not switch)', async () => {
    const user = userEvent.setup();
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 });

    // Start editing the note (press selects; Enter starts editing).
    act(() => pointerEvent(app.note(id), 'pointerdown', 100, 100));
    act(() => windowKeyDown('Enter'));
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(textarea));

    // Typing "t" in the editor must not arm the text tool.
    await user.type(textarea, 't');
    expect(textarea.value).toBe('t');
    expect(screen.getByLabelText('Text (T)').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByLabelText('Select (V)').getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-17: Text active, click the board at (300,200) → text object at that point, tool → Select, editor mounts', async () => {
    const app = await renderApp();
    act(() => windowKeyDown('t'));
    expect(screen.getByLabelText('Text (T)').getAttribute('aria-pressed')).toBe('true');

    // Click empty board space at viewport (300, 200) (jsdom rect is 0,0 → same point).
    const vp = getViewport();
    act(() => pointerEvent(vp, 'pointerdown', 300, 200));
    act(() => pointerEvent(vp, 'pointerup', 300, 200));

    // Exactly one text object, top-left at the click point, size M.
    const ids = textObjects(app.doc);
    expect(ids).toHaveLength(1);
    const obj = textObject(app.doc, ids[0]);
    expect(obj.get('x')).toBe(300);
    expect(obj.get('y')).toBe(200);
    expect(obj.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(obj.get('widthMode')).toBe('auto');
    expect(getTextContent(app.doc, ids[0])!.toString()).toBe('');

    // The tool returned to Select and the editor is open (caret in the textarea).
    expect(screen.getByLabelText('Select (V)').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('text-editor')).toBeTruthy();
    const ta = screen.getByTestId('text-textarea');
    await waitFor(() => expect(document.activeElement).toBe(ta));
  });

  it('TC-18: N creates a sticky note at the view centre (regression)', async () => {
    const app = await renderApp();
    expect(app.notes()).toHaveLength(0);

    act(() => windowKeyDown('n'));
    expect(app.notes()).toHaveLength(1);
    // jsdom: 1024×768 → centre 512,384; note is 200×200 top-left at centre-100.
    expect(app.notes()[0].x).toBe(window.innerWidth / 2 - 100);
    expect(app.notes()[0].y).toBe(window.innerHeight / 2 - 100);
    // Editing started immediately.
    expect(screen.getByTestId('sticky-text-editor')).toBeTruthy();
  });
});
