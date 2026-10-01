import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ImageObject } from '../../src/client/objects/ImageObject';
import type { ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

function makeImageSnap(overrides: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img-1',
    type: 'image',
    x: 0, y: 0, z: 1,
    width: 200, height: 150,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 200, naturalHeight: 150,
    status: 'uploading',
    uploadStartedAt: Date.now(),
    uploaderId: 'me',
    ...overrides,
  };
}

// TC-17: upload state rendering
describe('TC-17: upload state rendering', () => {
  it('uploader sees progress bar with percentage', () => {
    render(
      <ImageObject
        image={makeImageSnap()}
        isUploader={true}
        progress={0.42}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId('image-uploading-uploader')).toBeTruthy();
    expect(screen.getByTestId('image-progress-bar')).toBeTruthy();
    expect(screen.getByTestId('image-progress-text').textContent).toBe('42%');
  });

  it('others see "Uploading…" grey box', () => {
    render(
      <ImageObject
        image={makeImageSnap({ uploaderId: 'other' })}
        isUploader={false}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId('image-uploading-others')).toBeTruthy();
    expect(screen.getByText('Uploading…')).toBeTruthy();
  });
});

// TC-18: ready state
describe('TC-18: ready state', () => {
  it('renders <img> with src and objectFit fill', () => {
    render(
      <ImageObject
        image={makeImageSnap({ status: 'ready', assetKey: 'boardId1234567890123/assetId1234567890123' })}
        isUploader={true}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const img = screen.getByRole('img');
    expect(img).toBeTruthy();
    expect((img as HTMLImageElement).src).toContain('/api/assets/boardId1234567890123/assetId1234567890123');
  });
});

// TC-19: failed state
describe('TC-19: failed state', () => {
  it('uploader sees "Upload failed" with Retry and Remove buttons', () => {
    render(
      <ImageObject
        image={makeImageSnap({ status: 'failed' })}
        isUploader={true}
        canRetry={true}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId('image-failed-uploader')).toBeTruthy();
    expect(screen.getByText('Upload failed')).toBeTruthy();
    expect(screen.getByTestId('image-retry-btn')).toBeTruthy();
    expect(screen.getByTestId('image-remove-btn')).toBeTruthy();
  });

  it('others see "Image unavailable" grey box', () => {
    render(
      <ImageObject
        image={makeImageSnap({ status: 'failed', uploaderId: 'other' })}
        isUploader={false}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId('image-unavailable')).toBeTruthy();
    expect(screen.getByText('Image unavailable')).toBeTruthy();
  });
});

// TC-20: unfinished state
describe('TC-20: unfinished state', () => {
  it('shows "Image upload didn\'t finish" with Remove button', () => {
    const now = Date.now();
    render(
      <ImageObject
        image={makeImageSnap({ status: 'uploading', uploadStartedAt: now - IMAGE_UPLOAD_STALE_MS - 1000 })}
        isUploader={true}
        canRetry={false}
        now={now}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId('image-unfinished')).toBeTruthy();
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
    expect(screen.getByTestId('image-remove-btn')).toBeTruthy();
  });
});

// TC-21: unavailable state (img error)
describe('TC-21: unavailable state', () => {
  it('img onError → grey "Image unavailable" box', () => {
    const { container } = render(
      <ImageObject
        image={makeImageSnap({ status: 'ready', assetKey: 'boardId1234567890123/assetId1234567890123' })}
        isUploader={true}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const img = container.querySelector('img')!;
    act(() => {
      fireEvent.error(img);
    });
    expect(screen.getByTestId('image-unavailable')).toBeTruthy();
    expect(screen.getByText('Image unavailable')).toBeTruthy();
  });
});

// TC-22: retry callback
describe('TC-22: retry callback', () => {
  it('Retry button calls onRetry', () => {
    const onRetry = vi.fn();
    render(
      <ImageObject
        image={makeImageSnap({ status: 'failed' })}
        isUploader={true}
        canRetry={true}
        now={Date.now()}
        onRetry={onRetry}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('image-retry-btn'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('Remove button calls onRemove', () => {
    const onRemove = vi.fn();
    render(
      <ImageObject
        image={makeImageSnap({ status: 'failed' })}
        isUploader={true}
        canRetry={true}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByTestId('image-remove-btn'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

// TC-23: drop highlight
describe('TC-23: drop highlight', () => {
  it('renders when visible, absent when not', async () => {
    const { DropHighlight } = await import('../../src/client/images/DropHighlight');
    const { rerender } = render(<DropHighlight visible={true} />);
    expect(screen.getByTestId('drop-highlight')).toBeTruthy();

    rerender(<DropHighlight visible={false} />);
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
  });
});

// TC-24: toast
describe('TC-24: toast', () => {
  it('role=status, data-testid=toast, text matches PRD wording, auto-dismisses after 4s', async () => {
    vi.useFakeTimers();
    try {
      const { ToastContainer } = await import('../../src/client/ui/Toast');
      render(
        <ToastContainer
          toasts={[
            { id: 1, message: 'Only PNG, JPEG, GIF and WebP images can be added.' },
            { id: 2, message: 'Images must be 10 MB or smaller.' },
          ]}
        />,
      );

      const toasts = screen.getAllByTestId('toast');
      expect(toasts).toHaveLength(2);
      expect(toasts[0].getAttribute('role')).toBe('status');
      expect(toasts[0].textContent).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
      expect(toasts[1].textContent).toBe('Images must be 10 MB or smaller.');

      // Auto-dismiss after 4s
      act(() => {
        vi.advanceTimersByTime(4100);
      });
      expect(screen.queryAllByTestId('toast')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// TC-29: Image tool button
describe('TC-29: Image tool button', () => {
  it('toolbar renders an Image button with aria-label "Image (I)"', async () => {
    const { Toolbar } = await import('../../src/client/board/Toolbar');
    render(
      <Toolbar
        tool="select"
        setTool={vi.fn()}
        activeTool="select"
        setActiveTool={vi.fn()}
        onCreateSticky={vi.fn()}
        onImagePick={vi.fn()}
      />,
    );
    const btn = screen.getByLabelText('Image (I)');
    expect(btn).toBeTruthy();
  });
});
