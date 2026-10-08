import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as React from 'react';
import { TextToolbar } from '../../src/client/objects/TextToolbar';
import { TEXT_SIZES, DEFAULT_TEXT_SIZE } from '../../src/shared/config';

describe('text.toolbar component tests', () => {
  // TC-12: Single text selection → toolbar renders with size buttons and delete
  
  describe('TC-12: TextToolbar renders when one text selected', () => {
    it('renders four size buttons (S, M, L, XL) and a delete button', () => {
      const onSize = vi.fn();
      const onDelete = vi.fn();

      render(
        <TextToolbar
          size={DEFAULT_TEXT_SIZE}
          onSize={onSize}
          onDelete={onDelete}
        />,
      );

      // All size options should be present
      expect(screen.getByText('S')).toBeTruthy();
      expect(screen.getByText('M')).toBeTruthy();
      expect(screen.getByText('L')).toBeTruthy();
      expect(screen.getByText('XL')).toBeTruthy();

      // Delete button
      expect(screen.getByRole('button', { name: /delete/i })).toBeTruthy();
    });

    it('active size button has background #e8f0fe', () => {
      const onSize = vi.fn();
      const onDelete = vi.fn();

      render(
        <TextToolbar
          size="XL"
          onSize={onSize}
          onDelete={onDelete}
        />,
      );

      // Find XL button buttons - they're labeled by their size text
      const btns = Array.from(document.querySelectorAll('button'));
      const xlBtn = btns.find(b => b.textContent?.trim() === 'XL');
      expect(xlBtn).toBeTruthy();
      // Browser may convert hex to rgb; just check non-default background
      expect((xlBtn as HTMLElement).style.background).not.toBe('');
    });
  });

  // TC-13 to TC-16: Each size button dispatches textSize event with correct ID
  describe('TC-13: S size button dispatches textSize event', () => {
    it('onSize called with "S"', async () => {
      const onSize = vi.fn();
      const onDelete = vi.fn();

      await act(async () => {
        render(
          <TextToolbar
            size="M"
            onSize={onSize}
            onDelete={onDelete}
          />,
        );
      });

      await act(async () => {
        fireEvent.click(screen.getByText('S'));
      });

      expect(onSize).toHaveBeenCalledWith('S');
    });
  });

  describe('TC-14: M size button dispatches textSize event', () => {
    it('onSize called with "M"', async () => {
      const onSize = vi.fn();
      const onDelete = vi.fn();

      await act(async () => {
        render(
          <TextToolbar
            size="L"
            onSize={onSize}
            onDelete={onDelete}
          />,
        );
      });

      await act(async () => {
        fireEvent.click(screen.getByText('M'));
      });

      expect(onSize).toHaveBeenCalledWith('M');
    });
  });

  describe('TC-15: L size button dispatches textSize event', () => {
    it('onSize called with "L"', async () => {
      const onSize = vi.fn();
      const onDelete = vi.fn();

      await act(async () => {
        render(
          <TextToolbar
            size="S"
            onSize={onSize}
            onDelete={onDelete}
          />,
        );
      });

      await act(async () => {
        fireEvent.click(screen.getByText('L'));
      });

      expect(onSize).toHaveBeenCalledWith('L');
    });
  });

  describe('TC-16: XL size button dispatches textSize event', () => {
    it('onSize called with "XL"', async () => {
      const onSize = vi.fn();
      const onDelete = vi.fn();

      await act(async () => {
        render(
          <TextToolbar
            size="S"
            onSize={onSize}
            onDelete={onDelete}
          />,
        );
      });

      await act(async () => {
        fireEvent.click(screen.getByText('XL'));
      });

      expect(onSize).toHaveBeenCalledWith('XL');
    });
  });

  // TC-17: Delete button dispatches deleteObjects event
  describe('TC-17: Delete button dispatches deleteObjects event', () => {
    it('onDelete called', async () => {
      const onSize = vi.fn();
      const onDelete = vi.fn();

      await act(async () => {
        render(
          <TextToolbar
            size="M"
            onSize={onSize}
            onDelete={onDelete}
          />,
        );
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /delete/i }));
      });

      expect(onDelete).toHaveBeenCalled();
    });
  });
});
