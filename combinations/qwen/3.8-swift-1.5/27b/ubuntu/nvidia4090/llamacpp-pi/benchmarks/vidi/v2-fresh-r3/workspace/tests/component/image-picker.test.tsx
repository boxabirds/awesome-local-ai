/**
 * TC-19: picker (ui-component) — Image button and I shortcut.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, act } from '@testing-library/react';
import { renderApp, windowKeyDown, imageFile, imageSlices, setMockConnection } from './appHarness';

afterEach(cleanup);

async function settle() {
  await act(async () => {});
}

function pickerInput(): HTMLInputElement | null {
  return document.querySelector('input[type="file"][data-testid="image-file-input"]');
}

/** Simulates the user choosing files in the (jsdom) picker. */
function pick(files: File[]) {
  const input = pickerInput();
  if (!input) throw new Error('picker input not found');
  Object.defineProperty(input, 'files', { value: files });
  return act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('TC-19: picker (ui-component)', () => {
  it('Image button → picker opens; choosing files → placeholders at the view centre', async () => {
    const app = await renderApp();

    act(() => {
      screen.getByLabelText('Image (I)').click();
    });
    expect(pickerInput()).toBeTruthy();

    await pick([imageFile('picked.png', 'image/png', { width: 50, height: 50 })]);
    await settle();

    const imgs = imageSlices(app.doc);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].status).toBe('uploading');
    // Centred: 50×50 at (512-25, 384-25).
    expect(imgs[0].x).toBe(487);
    expect(imgs[0].y).toBe(359);
  });

  it('I shortcut opens the picker', async () => {
    await renderApp();

    act(() => windowKeyDown('i'));
    expect(pickerInput()).toBeTruthy();
  });

  it('while offline the picker is not opened (offline message instead)', async () => {
    await renderApp();

    setMockConnection('reconnecting');
    act(() => screen.getByLabelText('Image (I)').click());
    expect(pickerInput()).toBeNull();

    setMockConnection('connected');
    act(() => screen.getByLabelText('Image (I)').click());
    expect(pickerInput()).toBeTruthy();
  });
});
