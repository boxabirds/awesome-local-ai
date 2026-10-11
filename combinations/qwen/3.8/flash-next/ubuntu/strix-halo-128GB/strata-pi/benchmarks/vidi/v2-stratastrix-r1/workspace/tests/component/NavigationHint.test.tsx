import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  NAVIGATION_HINT_TEXT,
  NavigationHint,
} from '../../src/client/canvas/NavigationHint';
import { hint, renderBoard, settled, zoomInButton } from './helpers';

describe('NavigationHint', () => {
  it('shows the exact first-use text near the bottom centre', () => {
    render(<NavigationHint visible />);
    const hint = document.querySelector('[data-testid="navigation-hint"]');
    expect(hint?.textContent).toBe('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');
    expect(NAVIGATION_HINT_TEXT).toBe('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');
    expect(hint?.getAttribute('role')).toBe('status');
  });

  it('renders nothing when it is not visible', () => {
    render(<NavigationHint visible={false} />);
    expect(document.querySelector('[data-testid="navigation-hint"]')).toBeNull();
  });

  // TC-22
  it('TC-22: is visible at first, hidden by the first camera change and stays hidden', async () => {
    renderBoard();
    expect(hint()).not.toBeNull();

    fireEvent.click(zoomInButton());
    await settled();
    expect(hint()).toBeNull();

    // ... and further navigation does not bring it back during the visit.
    fireEvent.click(zoomInButton());
    await settled();
    expect(hint()).toBeNull();
  });
});
