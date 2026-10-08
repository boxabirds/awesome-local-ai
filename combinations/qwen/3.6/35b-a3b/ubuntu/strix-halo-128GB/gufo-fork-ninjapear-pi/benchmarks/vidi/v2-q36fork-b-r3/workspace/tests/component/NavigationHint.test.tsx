import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { NavigationHint } from '@client/canvas/NavigationHint';

describe('NavigationHint', () => {
  afterEach(() => {
    cleanup();
  });

  describe('TC-22: visible → hidden after first camera change', () => {
    it('visible=true renders hint text', () => {
      const { container } = render(<NavigationHint visible={true} />);
      expect(container.querySelector('div')).not.toBeNull();
      expect(container.textContent).toContain('Drag to move around');
      expect(container.textContent).toContain('Ctrl/Cmd + scroll or pinch to zoom');
    });

    it('visible=false returns null (no DOM)', () => {
      const { container } = render(<NavigationHint visible={false} />);
      expect(container.textContent).toBe('');
    });
  });
});
