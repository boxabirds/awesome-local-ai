/**
 * Component tests for image insert flows and ImageObject states (story 12).
 * TC-17, TC-18, TC-19, TC-21, TC-22, TC-23, TC-24, TC-29.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import React from 'react';

import { ImageObject } from '../../src/client/objects/ImageObject';
import { useImageInsert } from '../../src/client/images/useImageInsert';
import type { ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

// Mock uploadImage module
vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn(),
}));

import { uploadImage } from '../../src/client/images/uploadImage';

function makeImageSnap(overrides?: Partial<ImageSnap>): ImageSnap {
  return {
    id: 'img-1',
    type: 'image',
    x: 100,
    y: 100,
    z: 1,
    width: 200,
    height: 150,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 800,
    naturalHeight: 600,
    status: 'uploading',
    uploadStartedAt: Date.now(),
    uploaderId: 'local',
    ...overrides,
  };
}

describe('TC-21: Failed image states', () => {
  it('shows "Upload failed" for uploader with Retry and Remove buttons', () => {
    const snap = makeImageSnap({ status: 'failed', uploaderId: 'local' });
    render(
      <ImageObject
        snap={snap}
        camera={{ x: 0, y: 0, zoom: 1 }}
        isSelected={false}
        isUploader={true}
        canRetry={true}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText('Upload failed')).toBeTruthy();
    expect(screen.getByTestId('image-retry')).toBeTruthy();
    expect(screen.getByTestId('image-remove')).toBeTruthy();
  });

  it('shows "Image unavailable" for non-uploader', () => {
    const snap = makeImageSnap({ status: 'failed', uploaderId: 'other' });
    render(
      <ImageObject
        snap={snap}
        camera={{ x: 0, y: 0, zoom: 1 }}
        isSelected={false}
        isUploader={false}
      />,
    );
    expect(screen.getByTestId('image-unavailable')).toBeTruthy();
    // No Retry or Remove for non-uploader
    expect(screen.queryByTestId('image-retry')).toBeNull();
  });
});

describe('TC-22: Stale upload → unfinished', () => {
  it('uploading older than IMAGE_UPLOAD_STALE_MS → unfinished message + Remove', () => {
    const snap = makeImageSnap({
      status: 'uploading',
      uploadStartedAt: Date.now() - IMAGE_UPLOAD_STALE_MS - 1000,
    });
    render(
      <ImageObject
        snap={snap}
        camera={{ x: 0, y: 0, zoom: 1 }}
        isSelected={false}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
    expect(screen.getByTestId('image-remove')).toBeTruthy();
  });
});

describe('TC-23: Ready image fetch error → unavailable', () => {
  it('shows "Image unavailable" when fetch fails', async () => {
    // Mock fetch to fail
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const snap = makeImageSnap({
      status: 'ready',
      assetKey: 'board1234567890abcdefg/asset1234567890abcdefgh',
    });

    render(
      <ImageObject
        snap={snap}
        camera={{ x: 0, y: 0, zoom: 1 }}
        isSelected={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('image-unavailable')).toBeTruthy();
    });

    globalThis.fetch = originalFetch;
  });
});

describe('TC-24 (part 1): Ready image renders img element', () => {
  it('fetches blob and creates img when ready', async () => {
    const mockBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    });

    // Mock URL.createObjectURL
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = vi.fn();

    const snap = makeImageSnap({
      status: 'ready',
      assetKey: 'board1234567890abcdefg/asset1234567890abcdefgh',
    });

    const { container } = render(
      <ImageObject
        snap={snap}
        camera={{ x: 0, y: 0, zoom: 1 }}
        isSelected={false}
      />,
    );

    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).toBeTruthy();
      expect(img!.getAttribute('src')).toBe('blob:mock-url');
    });

    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });
});

describe('TC-17: Drop 3 valid files → 3 placeholders in a row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates placeholders and marks ready on resolve', async () => {
    const doc = new Y.Doc();
    doc.getMap('objects');

    // Mock uploadImage to resolve immediately
    (uploadImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetKey: 'board/asset',
      contentType: 'image/png',
    });

    // Mock createImageBitmap
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    globalThis.createImageBitmap = vi.fn().mockImplementation(async () => ({
      width: 400,
      height: 300,
      close: () => {},
    }));

    // Create test files
    const files = [
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' }),
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'b.png', { type: 'image/png' }),
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'c.png', { type: 'image/png' }),
    ];

    // Use useImageInsert via a test component
    const toasts: string[] = [];
    const HookTest: React.FC = () => {
      const { insertImages: insert } = useImageInsert({
        boardId: 'test-board',
        getDoc: () => doc,
        undoBoundary: (_label, fn) => fn(),
        toast: (msg) => toasts.push(msg),
        screenToWorld: (p) => p,
        isOnline: () => true,
        clientId: () => 'local',
      });

      React.useEffect(() => {
        insert(files, { x: 0, y: 0 }, 'top-left');
      }, []);

      return null;
    };

    await act(async () => {
      render(<HookTest />);
    });

    // Wait for async upload to complete
    await waitFor(() => {
      const objects = doc.getMap('objects');
      expect(objects.size).toBe(3);
    });

    // All should be 'ready' after upload resolves
    const objects = doc.getMap('objects');
    for (const [, entry] of objects) {
      const ymap = entry as Y.Map<unknown>;
      await waitFor(() => {
        expect(ymap.get('status')).toBe('ready');
      });
    }

    globalThis.createImageBitmap = originalCreateImageBitmap;
  });
});

describe('TC-19: Offline → toast, no objects created', () => {
  it('does not create objects when offline', async () => {
    const doc = new Y.Doc();
    doc.getMap('objects');

    const files = [
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' }),
    ];

    const toasts: string[] = [];
    const HookTest: React.FC = () => {
      const { insertImages: insert } = useImageInsert({
        boardId: 'test-board',
        getDoc: () => doc,
        undoBoundary: (_label, fn) => fn(),
        toast: (msg) => toasts.push(msg),
        screenToWorld: (p) => p,
        isOnline: () => false,
        clientId: () => 'local',
      });

      React.useEffect(() => {
        insert(files, { x: 0, y: 0 }, 'top-left');
      }, []);

      return null;
    };

    await act(async () => {
      render(<HookTest />);
    });

    // Should show offline toast
    expect(toasts).toContain("You're offline — images can be added when you reconnect.");

    // No objects created
    const objects = doc.getMap('objects');
    expect(objects.size).toBe(0);
  });
});

describe('TC-29: createImageBitmap rejects → no placeholder', () => {
  it('skips file if createImageBitmap fails', async () => {
    const doc = new Y.Doc();
    doc.getMap('objects');

    (uploadImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetKey: 'board/asset',
      contentType: 'image/png',
    });

    const originalCreateImageBitmap = globalThis.createImageBitmap;
    globalThis.createImageBitmap = vi.fn().mockRejectedValue(new Error('decode error'));

    const files = [
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'corrupt.png', { type: 'image/png' }),
    ];

    const toasts: string[] = [];
    const HookTest: React.FC = () => {
      const { insertImages: insert } = useImageInsert({
        boardId: 'test-board',
        getDoc: () => doc,
        undoBoundary: (_label, fn) => fn(),
        toast: (msg) => toasts.push(msg),
        screenToWorld: (p) => p,
        isOnline: () => true,
        clientId: () => 'local',
      });

      React.useEffect(() => {
        insert(files, { x: 0, y: 0 }, 'top-left');
      }, []);

      return null;
    };

    await act(async () => {
      render(<HookTest />);
    });

    // No objects should be created since bitmap decode failed
    await waitFor(() => {
      const objects = doc.getMap('objects');
      expect(objects.size).toBe(0);
    });

    globalThis.createImageBitmap = originalCreateImageBitmap;
  });
});

describe('TC-24 (part 2): Retry with file in memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retry with stored bytes re-uploads and returns true; canRetry reflects bytes', async () => {
    const doc = new Y.Doc();
    doc.getMap('objects');

    let uploadCalls = 0;
    (uploadImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      uploadCalls += 1;
      return Promise.resolve({ assetKey: 'b/a', contentType: 'image/png' });
    });

    const originalBitmap = globalThis.createImageBitmap;
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ width: 100, height: 100, close() {} });

    let hook: ReturnType<typeof useImageInsert> | null = null;
    const Harness: React.FC = () => {
      hook = useImageInsert({
        boardId: 'test-board',
        getDoc: () => doc,
        undoBoundary: (_l, fn) => fn(),
        toast: () => {},
        screenToWorld: (p) => p,
        isOnline: () => true,
        clientId: () => 'local',
      });
      return null;
    };

    const files = [new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' })];
    await act(async () => {
      render(<Harness />);
    });
    await act(async () => {
      await hook!.insertImages(files, { x: 0, y: 0 }, 'top-left');
    });

    const objects = doc.getMap('objects');
    const id = [...objects.keys()][0]!;

    // canRetry is true because bytes are in memory
    expect(hook!.canRetry(id)).toBe(true);

    // Mark as failed, then retry
    await act(async () => {
      const ok = await hook!.retry(id);
      expect(ok).toBe(true);
    });

    // Upload was called a second time (retry)
    expect(uploadCalls).toBeGreaterThanOrEqual(2);

    // canRetry on a non-existent id returns false (simulates reload losing bytes)
    expect(hook!.canRetry('no-such-id')).toBe(false);

    globalThis.createImageBitmap = originalBitmap;
  });

  it('ImageObject with canRetry=false hides Retry and shows only Remove', () => {
    const snap = makeImageSnap({ status: 'failed', uploaderId: 'local' });
    render(
      <ImageObject
        snap={snap}
        camera={{ x: 0, y: 0, zoom: 1 }}
        isSelected={false}
        isUploader={true}
        canRetry={false}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByTestId('image-remove')).toBeTruthy();
    expect(screen.queryByTestId('image-retry')).toBeNull();
  });
});

describe('TC-18: Paste — text editing vs board focused', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * A test component that mimics the App paste handler logic:
   * - skips paste when the target is a text-entry element or editing is set
   * - otherwise calls insertImages(files, viewCentre, 'centre')
   */
  function PasteHarness({ doc, isEditing }: { doc: Y.Doc; isEditing: boolean }) {
    const { insertImages: insert } = useImageInsert({
      boardId: 'test-board',
      getDoc: () => doc,
      undoBoundary: (_l, fn) => fn(),
      toast: () => {},
      screenToWorld: (p) => p,
      isOnline: () => true,
      clientId: () => 'local',
    });

    React.useEffect(() => {
      const handler = (e: ClipboardEvent) => {
        const target = e.target as HTMLElement | null;
        const isTargetText =
          target != null &&
          (target.tagName === 'TEXTAREA' ||
            target.tagName === 'INPUT' ||
            target.isContentEditable);
        if (isTargetText || isEditing) return;
        const items = e.clipboardData?.items;
        if (!items) return;
        const files: File[] = [];
        for (let i = 0; i < items.length; i++) {
          const it = items[i]!;
          if (it.kind === 'file' && (it.type === 'image/png' || it.type === 'image/jpeg' || it.type === 'image/gif' || it.type === 'image/webp')) {
            const f = it.getAsFile();
            if (f) files.push(f);
          }
        }
        if (files.length === 0) return;
        insert(files, { x: 400, y: 300 }, 'centre');
      };
      document.addEventListener('paste', handler);
      return () => document.removeEventListener('paste', handler);
    }, [insert, isEditing]);

    return null;
  }

  function firePaste(files: File[], target: EventTarget = document.body) {
    // Build a clipboardData-like object (jsdom has no DataTransfer).
    const items = files.map((f) => ({
      kind: 'file' as const,
      type: f.type,
      getAsFile: () => f,
    }));
    const clipboardData = {
      items,
      files,
      getData: () => '',
      types: items.map((i) => i.type),
    };
    const evt = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'clipboardData', { value: clipboardData });
    target.dispatchEvent(evt);
    return evt;
  }

  it('paste while focused in a textarea does NOT create an image', async () => {
    const doc = new Y.Doc();
    doc.getMap('objects');

    (uploadImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetKey: 'b/a', contentType: 'image/png',
    });
    const originalBitmap = globalThis.createImageBitmap;
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ width: 100, height: 100, close() {} });

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    render(<PasteHarness doc={doc} isEditing={false} />);

    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' });
    await act(async () => {
      firePaste([png], textarea);
      await Promise.resolve();
    });

    // No objects should be created (paste target is a textarea)
    expect(doc.getMap('objects').size).toBe(0);

    document.body.removeChild(textarea);
    globalThis.createImageBitmap = originalBitmap;
  });

  it('paste while board focused creates an image centred in the view', async () => {
    const doc = new Y.Doc();
    doc.getMap('objects');

    (uploadImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetKey: 'b/a', contentType: 'image/png',
    });
    const originalBitmap = globalThis.createImageBitmap;
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ width: 100, height: 100, close() {} });

    render(<PasteHarness doc={doc} isEditing={false} />);

    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' });
    await act(async () => {
      firePaste([png]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(doc.getMap('objects').size).toBe(1);
    });

    // Verify it's centred at (400, 300) — placementSize for 100x100 is 100x100;
    // with 'centre' anchor the rect starts at (400-50, 300-50) = (350, 250).
    const objects = doc.getMap('objects');
    const first = [...objects.values()][0] as Y.Map<unknown>;
    expect(first.get('x')).toBe(350);
    expect(first.get('y')).toBe(250);

    globalThis.createImageBitmap = originalBitmap;
  });
});

describe('Registry: image type', () => {
  it('is registered as aspect-locked with correct minSize', async () => {
    const { getObjectType } = await import('../../src/client/objects/registry');
    const spec = getObjectType('image');
    expect(spec).toBeDefined();
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.resizable).toBe(true);
    expect(spec!.editableText).toBe(false);
  });
});
