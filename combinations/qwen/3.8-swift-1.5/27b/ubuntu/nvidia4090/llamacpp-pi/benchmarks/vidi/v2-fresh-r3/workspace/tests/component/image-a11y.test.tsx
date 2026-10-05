/**
 * TC-29: image a11y (ui-component) — tooltips and live regions.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, act } from '@testing-library/react';
import { renderApp, viewportDrag, imageFile, setMockConnection } from './appHarness';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';

afterEach(cleanup);

async function settle() {
  await act(async () => {});
}

describe('TC-29: image a11y (ui-component)', () => {
  it('the Image button has a tooltip', async () => {
    await renderApp();
    const btn = screen.getByLabelText('Image (I)');
    expect(btn.getAttribute('title')).toBeTruthy();
  });

  it('upload progress is an accessible progressbar (live value)', async () => {
    await renderApp();

    viewportDrag('drop', [imageFile('a.png', 'image/png')]);
    await settle();

    const bar = screen.getByTestId('image-progress-bar');
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(bar.getAttribute('aria-label')).toBeTruthy();
  });

  it('toasts are announced (role=status) and name the reason', async () => {
    await renderApp();

    setMockConnection('connecting');
    viewportDrag('drop', [imageFile('a.png', 'image/png')]);
    await settle();

    const toast = screen.getByText(REJECTION_MESSAGES.offline);
    expect(toast.getAttribute('role')).toBe('status');
  });
});
