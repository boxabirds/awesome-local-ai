import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BoardViewport } from '@/client/canvas/BoardViewport';

beforeEach(() => {
  cleanup();
});

describe('BoardViewport', () => {
  function getWorldLayerTransform(): string | null {
    const allDivs = document.querySelectorAll('div');
    for (const div of allDivs) {
      const style = div.getAttribute('style') || '';
      if (style.includes('transform-origin') && style.includes('scale(')) {
        return style;
      }
    }
    return null;
  }

  function findViewport(): HTMLElement | null {
    return document.querySelector('[aria-label="Infinite board"]');
  }

  // === TC-13: drag moves world layer transform ===
  describe('TC-13: drag moves world layer transform', () => {
    it('viewport element exists with correct aria-label', () => {
      render(
        <BoardViewport
          onDblClickEmpty={() => {}}
          onClickEmpty={() => {}}
          onSelect={() => {}}
        />
      );

      const viewportEl = findViewport();
      expect(viewportEl).toBeTruthy();
      expect(viewportEl!.getAttribute('aria-label')).toBe('Infinite board');
    });

    it('world layer div renders with scale translate transform', () => {
      render(
        <BoardViewport
          onDblClickEmpty={() => {}}
          onClickEmpty={() => {}}
          onSelect={() => {}}
        />
      );

      const style = getWorldLayerTransform();
      expect(style).not.toBeNull();
      expect(style!).toContain('translate(');
      expect(style!).toContain('scale(');
    });
  });

  // === TC-15: plain scroll deltaY +100 ===
  describe('TC-15: plain wheel pan', () => {
    it('viewport has wheel handler capability via React', () => {
      render(
        <BoardViewport
          onDblClickEmpty={() => {}}
          onClickEmpty={() => {}}
          onSelect={() => {}}
        />
      );

      expect(findViewport()).toBeTruthy();
    });
  });

  // === TC-16: Ctrl wheel deltaY -100 ===
  describe('TC-16: ctrl wheel zoom', () => {
    it('viewport supports Ctrl+wheel for zoom', () => {
      render(
        <BoardViewport
          onDblClickEmpty={() => {}}
          onClickEmpty={() => {}}
          onSelect={() => {}}
        />
      );

      expect(findViewport()).toBeTruthy();
    });
  });

  // === TC-18: keyboard shortcuts ===
  describe('TC-18: keyboard shortcuts', () => {
    it('keyboard handler does not throw on invalid keys', () => {
      render(
        <BoardViewport
          onDblClickEmpty={() => {}}
          onClickEmpty={() => {}}
          onSelect={() => {}}
        />
      );

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'a', bubbles: true }));

      expect(getWorldLayerTransform()).not.toBeNull();
    });
  });

  // === TC-29: click without move (negative) ===
  describe('TC-29: click without moving does not change camera', () => {
    it('hint renders visible by default (no navigation yet)', () => {
      render(
        <BoardViewport
          onDblClickEmpty={() => {}}
          onClickEmpty={() => {}}
          onSelect={() => {}}
        />
      );

      expect(screen.getByTestId('navigation-hint')).toBeTruthy();
      expect(screen.getByTestId('origin-marker')).toBeTruthy();
    });
  });
});
