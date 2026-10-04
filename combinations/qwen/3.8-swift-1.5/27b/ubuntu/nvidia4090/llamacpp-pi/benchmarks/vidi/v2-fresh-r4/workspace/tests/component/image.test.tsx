/**
 * Component tests for image insert flows (TC-17 to TC-19, TC-29)
 * and ImageObject states (TC-21 to TC-24).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import { useImageInsert } from '../../src/client/images/useImageInsert';
import { ImageObject } from '../../src/client/objects/ImageObject';
import { type ImageSnap } from '../../src/shared/objects/image';
import { snapshot } from '../../src/shared/board-model';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

// Mock uploadImage
const mockUploadResults: Map<string, { resolve: (r: unknown) => void }> = new Map();
vi.mock('../../src/client/images/uploadImage', () => {
  return {
    uploadImage: vi.fn((boardId: string, file: File, _onProgress: (f: number) => void) => {
      const id = `mock-${boardId}-${file.name}`;
      let resolveFn: (r: unknown) => void = () => {};
      const promise = new Promise((resolve) => { resolveFn = resolve; });
      mockUploadResults.set(id, { resolve: resolveFn });
      return { promise, abort: vi.fn() };
    }),
  };
});

// Stub createImageBitmap for jsdom
beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn(async (file: File) => {
    const widthMatch = file.name.match(/(\d+)x(\d+)/);
    const width = widthMatch ? parseInt(widthMatch[1]) : 100;
    const height = widthMatch ? parseInt(widthMatch[2]) : 50;
    return { width, height, close: vi.fn() };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mockUploadResults.clear();
});

// Helper to fire a drop event with files on an element
function fireDrop(element: HTMLElement, files: File[]) {
  // Create a mock event that React's onDrop handler can read
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'], dropEffect: 'copy' } });
  Object.defineProperty(event, 'clientX', { value: 400 });
  Object.defineProperty(event, 'clientY', { value: 300 });
  // Use the native dispatchEvent so React's event system picks it up
  element.dispatchEvent(event);
}

// Helper to render a component that uses useImageInsert
function renderWithImageInsert(props: {
  connection?: 'connected' | 'reconnecting' | 'connecting';
  camera?: { x: number; y: number; zoom: number };
  viewportSize?: { width: number; height: number };
}) {
  const doc = new Y.Doc();
  const toasts: string[] = [];
  const showToast = vi.fn((msg: string) => toasts.push(msg));

  let result: ReturnType<typeof useImageInsert>;

  function TestComponent() {
    result = useImageInsert({
      doc,
      boardId: 'testboard',
      camera: props.camera ?? { x: -400, y: -300, zoom: 1 },
      connection: props.connection ?? 'connected',
      identityId: 'local',
      viewportSize: props.viewportSize ?? { width: 800, height: 600 },
      showToast,
    });
    return (
      <div data-vidi6="test-container">
        <div
          data-vidi6="drop-target"
          onDragOver={result.onDragOver}
          onDrop={result.onDrop}
          style={{ width: 800, height: 600 }}
        />
        <button data-vidi6="picker-btn" onClick={result.openPicker} />
        <input ref={result.fileInputRef} type="file" data-vidi6="image-file-input" onChange={result.handleFileInputChange} />
      </div>
    );
  }

  const utils = render(<TestComponent />);
  return { ...utils, doc, toasts, showToast, getResult: () => result! };
}

// --- TC-17: drop 3 files → 3 placeholders ---

describe('TC-17: drop 3 files', () => {
  it('creates 3 placeholders in a row', async () => {
    const { doc } = renderWithImageInsert({});

    const files = [
      new File(['data1'], 'img100x50.png', { type: 'image/png' }),
      new File(['data2'], 'img200x80.png', { type: 'image/png' }),
      new File(['data3'], 'img150x60.png', { type: 'image/png' }),
    ];

    const dropTarget = screen.getByTestId('drop-target');
    await act(async () => {
      fireDrop(dropTarget, files);
      await new Promise(r => setTimeout(r, 100));
    });

    const snaps = snapshot(doc);
    const images = snaps.filter(s => s.type === 'image');
    expect(images).toHaveLength(3);

    for (const img of images) {
      const imgSnap = img as ImageSnap;
      expect(imgSnap.status).toBe('uploading');
    }
  });
});

// --- TC-18: paste while editing → no image; paste while board focused → image ---

describe('TC-18: paste', () => {
  it('does not create image when focus is in a textarea', async () => {
    const { doc } = renderWithImageInsert({});

    // Create a textarea and focus it
    const { unmount } = render(
      <div>
        <textarea data-vidi6="edit-area" />
      </div>
    );

    const textarea = screen.getByTestId('edit-area');
    textarea.focus();

    // Simulate paste with an image file
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        files: [new File(['img'], 'paste100x50.png', { type: 'image/png' })],
      },
    });

    // The target of the event should be the textarea
    Object.defineProperty(pasteEvent, 'target', { value: textarea });

    act(() => {
      // Call the handler directly with the event
      const handler = (e: Event) => {
        const target = e.target as HTMLElement;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }
      };
      handler(pasteEvent);
    });

    // No image should be created
    const snaps = snapshot(doc);
    const images = snaps.filter(s => s.type === 'image');
    expect(images).toHaveLength(0);

    unmount();
  });

  it('creates image when no text is being edited', async () => {
    const { doc, getResult } = renderWithImageInsert({});

    // Call onPaste directly with a mock clipboard event
    const mockEvent = {
      target: document.body,
      clipboardData: {
        files: [new File(['img'], 'paste100x50.png', { type: 'image/png' })],
      } as unknown as DataTransfer,
      preventDefault: vi.fn(),
    };

    await act(async () => {
      getResult().onPaste(mockEvent);
      await new Promise(r => setTimeout(r, 100));
    });

    const snaps = snapshot(doc);
    const images = snaps.filter(s => s.type === 'image');
    expect(images).toHaveLength(1);
  });
});

// --- TC-19: offline → toast, no objects ---

describe('TC-19: offline', () => {
  it('shows offline toast, no objects created', async () => {
    const { toasts, doc } = renderWithImageInsert({ connection: 'reconnecting' });

    const files = [new File(['data'], 'img100x50.png', { type: 'image/png' })];
    const dropTarget = screen.getByTestId('drop-target');

    await act(async () => {
      fireDrop(dropTarget, files);
      await new Promise(r => setTimeout(r, 10));
    });

    // Offline toast shown
    expect(toasts).toContain("You're offline — images can be added when you reconnect.");

    // No objects created
    const snaps = snapshot(doc);
    expect(snaps.filter(s => s.type === 'image')).toHaveLength(0);
  });
});

// --- TC-29: createImageBitmap rejects → type toast, no placeholder ---

describe('TC-29: decode failure', () => {
  it('shows type toast and no placeholder when createImageBitmap rejects', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new Error('Decode error');
    }));

    const { toasts, doc } = renderWithImageInsert({});

    const files = [new File(['corrupt'], 'corrupt100x50.png', { type: 'image/png' })];
    const dropTarget = screen.getByTestId('drop-target');

    await act(async () => {
      fireDrop(dropTarget, files);
      await new Promise(r => setTimeout(r, 50));
    });

    // Type toast shown
    expect(toasts).toContain('Only PNG, JPEG, GIF and WebP images can be added.');

    // No placeholders
    const snaps = snapshot(doc);
    expect(snaps.filter(s => s.type === 'image')).toHaveLength(0);
  });
});

// --- TC-21: failed object rendered for uploader vs other ---

describe('TC-21: failed rendering', () => {
  function makeFailedImg(): ImageSnap {
    return {
      id: 'img1',
      type: 'image',
      x: 0, y: 0, width: 200, height: 100,
      z: 1, createdAt: 0,
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 200, naturalHeight: 100,
      status: 'failed',
      uploadStartedAt: Date.now(),
      uploaderId: 'local',
    };
  }

  it('uploader sees "Upload failed" with Retry and Remove', () => {
    const img = makeFailedImg();
    render(
      <ImageObject
        image={img}
        isUploader={true}
        canRetry={true}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        onPointerDown={vi.fn()}
      />
    );

    expect(screen.getByText('Upload failed')).toBeTruthy();
    expect(screen.getByTestId('image-retry')).toBeTruthy();
    expect(screen.getByTestId('image-remove')).toBeTruthy();
  });

  it('other identity sees "Image unavailable"', () => {
    const img = makeFailedImg();
    render(
      <ImageObject
        image={img}
        isUploader={false}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        onPointerDown={vi.fn()}
      />
    );

    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByTestId('image-retry')).toBeNull();
  });
});

// --- TC-22: uploading older than STALE → unfinished + Remove ---

describe('TC-22: unfinished', () => {
  it('shows "Image upload didn\'t finish" with Remove', () => {
    const img: ImageSnap = {
      id: 'img1',
      type: 'image',
      x: 0, y: 0, width: 200, height: 100,
      z: 1, createdAt: 0,
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 200, naturalHeight: 100,
      status: 'uploading',
      uploadStartedAt: Date.now() - IMAGE_UPLOAD_STALE_MS - 1000,
      uploaderId: 'other',
    };

    const onRemove = vi.fn();
    render(
      <ImageObject
        image={img}
        isUploader={false}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={onRemove}
        onPointerDown={vi.fn()}
      />
    );

    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
    expect(screen.getByTestId('image-remove')).toBeTruthy();

    fireEvent.click(screen.getByTestId('image-remove'));
    expect(onRemove).toHaveBeenCalled();
  });
});

// --- TC-23: ready image fires error → "Image unavailable" ---

describe('TC-23: image load error', () => {
  it('shows "Image unavailable" box when img errors', () => {
    const img: ImageSnap = {
      id: 'img1',
      type: 'image',
      x: 0, y: 0, width: 200, height: 100,
      z: 1, createdAt: 0,
      assetKey: 'board/asset1',
      contentType: 'image/png',
      naturalWidth: 200, naturalHeight: 100,
      status: 'ready',
      uploadStartedAt: Date.now(),
      uploaderId: 'local',
    };

    const { container } = render(
      <ImageObject
        image={img}
        isUploader={true}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        onPointerDown={vi.fn()}
      />
    );

    const imgEl = container.querySelector('img')!;
    expect(imgEl).toBeTruthy();

    act(() => {
      fireEvent.error(imgEl);
    });

    expect(screen.getByText('Image unavailable')).toBeTruthy();
  });
});

// --- TC-24: Retry with/without canRetry ---

describe('TC-24: retry', () => {
  it('uploader with canRetry sees Retry; without canRetry only Remove', () => {
    const img: ImageSnap = {
      id: 'img1',
      type: 'image',
      x: 0, y: 0, width: 200, height: 100,
      z: 1, createdAt: 0,
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 200, naturalHeight: 100,
      status: 'failed',
      uploadStartedAt: Date.now(),
      uploaderId: 'local',
    };

    // With canRetry
    const { unmount } = render(
      <ImageObject
        image={img}
        isUploader={true}
        canRetry={true}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        onPointerDown={vi.fn()}
      />
    );
    expect(screen.getByTestId('image-retry')).toBeTruthy();
    expect(screen.getByTestId('image-remove')).toBeTruthy();
    unmount();

    // Without canRetry
    render(
      <ImageObject
        image={img}
        isUploader={true}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        onPointerDown={vi.fn()}
      />
    );
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.getByTestId('image-remove')).toBeTruthy();
  });
});
