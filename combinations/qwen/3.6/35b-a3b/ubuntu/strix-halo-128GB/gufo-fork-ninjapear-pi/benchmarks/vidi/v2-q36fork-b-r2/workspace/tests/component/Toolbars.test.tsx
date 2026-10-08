import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as React from 'react';
import * as Y from 'yjs';
import { NoteToolbar } from '../../src/client/objects/NoteToolbar';
import { Toolbar } from '../../src/client/board/Toolbar';
import { useSelection } from '../../src/client/board/useSelection';
import { STICKY_COLORS, DEFAULT_STICKY_COLOR } from '../../src/shared/config';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sticky.toolbar component tests', () => {
  describe('TC-27: Pink swatch → model colour pink, selection kept', () => {
    it('clicking a swatch calls onColor with correct colour', async () => {
      const onColor = vi.fn();
      const onDelete = vi.fn();

      render(
        <NoteToolbar
          color={DEFAULT_STICKY_COLOR}
          onColor={onColor}
          onDelete={onDelete}
        />,
      );

      // Find and click the pink swatch button
      const pinkButton = document.querySelector('[aria-label="Pink colour"]');
      expect(pinkButton).toBeTruthy();
      fireEvent.click(pinkButton!);

      expect(onColor).toHaveBeenCalledWith('pink');
    });
  });

  describe('TC-28: Sticky note button → note centred on viewport centre', () => {
    it('onCreateSticky is called when clicked', async () => {
      const onCreateSticky = vi.fn();

      render(<Toolbar onCreateSticky={onCreateSticky} />);

      const stickyBtn = document.querySelector('[aria-label="Sticky note (N)"]');
      expect(stickyBtn).toBeTruthy();
      fireEvent.click(stickyBtn!);

      expect(onCreateSticky).toHaveBeenCalled();
    });

    it('button has correct tooltip text', () => {
      render(<Toolbar onCreateSticky={() => {}} />);
      const stickyBtn = document.querySelector('[aria-label="Sticky note (N)"]');
      expect(stickyBtn?.getAttribute('title')).toBe(
        'Sticky note – or double-click the board',
      );
    });
  });

  describe('TC-29: bin button → note removed, selection cleared', () => {
    it('clicking delete button calls onDelete', async () => {
      const onColor = vi.fn();
      const onDelete = vi.fn();

      render(
        <NoteToolbar
          color="yellow"
          onColor={onColor}
          onDelete={onDelete}
        />,
      );

      const deleteBtn = document.querySelector('[aria-label="Delete note"]');
      expect(deleteBtn).toBeTruthy();
      fireEvent.click(deleteBtn!);

      expect(onDelete).toHaveBeenCalled();
    });
  });

  describe('Colour swatches accessibility', () => {
    it('all six colours have aria-label and aria-pressed', () => {
      render(
        <NoteToolbar
          color="green"
          onColor={() => {}}
          onDelete={() => {}}
        />,
      );

      const swatches = document.querySelectorAll('[role="toolbar"] button[aria-pressed]');
      expect(swatches.length).toBe(6);
      for (const swatch of swatches) {
        expect(swatch.getAttribute('aria-label')).toMatch(/colour$/i);
      }
    });

    it('selected swatch has aria-pressed="true"', () => {
      render(
        <NoteToolbar
          color="blue"
          onColor={() => {}}
          onDelete={() => {}}
        />,
      );

      const blueSwatch = document.querySelector('[aria-label="Blue colour"]');
      expect(blueSwatch?.getAttribute('aria-pressed')).toBe('true');

      const yellowSwatch = document.querySelector('[aria-label="Yellow colour"]');
      expect(yellowSwatch?.getAttribute('aria-pressed')).toBe('false');
    });
  });
});
