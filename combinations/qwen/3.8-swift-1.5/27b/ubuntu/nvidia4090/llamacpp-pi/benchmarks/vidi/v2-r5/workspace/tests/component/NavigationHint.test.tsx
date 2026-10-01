// @vitest-environment jsdom
// tests/component/NavigationHint.test.tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';

afterEach(() => {
  cleanup();
});

describe('NavigationHint - nav.hint_display', () => {
  describe('TC-22: visible then hidden after camera changes', () => {
    it('shows hint when visible=true', () => {
      const { getByTestId } = render(<NavigationHint visible={true} />);
      const hint = getByTestId('navigation-hint');
      expect(hint).toBeTruthy();
      expect(hint.textContent).toBe('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');
    });

    it('hides hint when visible=false (after first camera change)', () => {
      const { queryByTestId } = render(<NavigationHint visible={false} />);
      expect(queryByTestId('navigation-hint')).toBeNull();
    });

    it('stays hidden after second camera change', () => {
      const { queryByTestId } = render(<NavigationHint visible={false} />);
      expect(queryByTestId('navigation-hint')).toBeNull();
    });
  });
});
