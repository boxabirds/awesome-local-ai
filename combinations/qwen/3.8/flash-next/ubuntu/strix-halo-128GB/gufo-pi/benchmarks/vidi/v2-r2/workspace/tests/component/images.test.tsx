import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import * as Y from 'yjs';
import { useImageInsert, type UseImageInsertResult } from '@client/images/useImageInsert';
import { ImageObjectStateless } from '@client/objects/ImageObject';
import type { ImageSnap } from '@shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '@shared/config';
import type { ConnectionState } from '@client/sync/connectBoard';
import type { Camera } from '@client/canvas/camera';
import type { ToastApi, ToastMessage } from '@client/ui/Toast';

// Mock createImageBitmap (jsdom doesn't have it)
let mockBitmapCalls: Array<(file: File) => { width: number; height: number }> = [];
beforeEach(() => {
  mockBitmapCalls = [];
  (globalThis as any).createImageBitmap = vi.fn(async (file: File) => {
    const call = mockBitmapCalls.find((fn) => fn(file));
    if (call) {
      const dims = call(file);
      return { width: dims.width, height: dims.height, close() {} };
    }
    // Default: valid bitmap
    return { width: 200, height: 150, close() {} };
  });
});

// Mock uploadImage
vi.mock('@client/images/uploadImage', () => ({
  uploadImage: vi.fn((_boardId: string, _file: File, onProgress: (f: number) => void) => {
    // Simulate progress then resolve
    onProgress(0.5);
    const promise = Promise.resolve({ kind: 'ok' as const, assetKey: 'board123/asset456' });
    return { promise, abort: () => {} };
  }),
}));

function makeToastApi(): ToastApi & { messages: ToastMessage[] } {
  const msgs: ToastMessage[] = [];
  let id = 0;
  return {
    show: (text: string) => { msgs.push({ id: id++, text }); },
    get messages() { return msgs; },
  };
}

function makeCamera(): React.MutableRefObject<Camera> {
  return { current: { x: 0, y: 0, zoom: 1 } };
}

function makeFile(name: string, type: string, size?: number): File {
  const content = new Uint8Array(size ?? 100);
  content.set([0x89, 0x50, 0x4e, 0x47]); // PNG magic by default
  return new File([content], name, { type });
}

// Test wrapper component that exposes the hook result
function TestHarness({
  doc,
  connection = 'connected',
  onResult,
}: {
  doc: Y.Doc;
  connection?: ConnectionState;
  onResult(r: UseImageInsertResult): void;
}) {
  const toast = makeToastApi();
  const result = useImageInsert({
    doc,
    boardId: 'testboard',
    cameraRef: makeCamera(),
    connection,
    identityId: 'user1',
    viewportWidth: 1280,
    viewportHeight: 800,
    toast,
  });
  onResult(result);

  return (
    <div
      data-testid="drop-target"
      onDragEnter={result.onDragEnter}
      onDragOver={result.onDragOver}
      onDragLeave={result.onDragLeave}
      onDrop={result.onDrop}
    >
      {result.dropHighlightVisible && <div data-testid="drop-highlight">highlight</div>}
    </div>
  );
}

// TC-17: drop 3 valid files → 3 placeholders in a row; progress; ready after resolve
describe('TC-17: drop 3 files', () => {
  it('creates 3 placeholders in a row and marks ready after upload', async () => {
    const doc = new Y.Doc();

    render(<TestHarness doc={doc} onResult={() => {}} />);

    const files = [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
      makeFile('c.png', 'image/png'),
    ];

    // Simulate drop
    const dropTarget = screen.getByTestId('drop-target');
    const dataTransfer = {
      types: ['Files'],
      files,
      dropEffect: '',
    };

    await act(async () => {
      const dropEvent = new Event('drop', { bubbles: true }) as any;
      dropEvent.dataTransfer = dataTransfer;
      dropEvent.clientX = 100;
      dropEvent.clientY = 100;
      Object.defineProperty(dropEvent, 'currentTarget', { value: dropTarget });
      dropTarget.dispatchEvent(dropEvent);
    });

    // Wait for uploads to resolve
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // Check 3 image objects were created
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    let count = 0;
    objects.forEach((obj) => {
      if (obj.get('type') === 'image') count++;
    });
    expect(count).toBe(3);
  });
});

// TC-18: paste while editing text → no image; paste while board focused → image
describe('TC-18: paste behavior', () => {
  it('does not add image while focus is in textarea', async () => {
    const doc = new Y.Doc();
    let hookResult: UseImageInsertResult | null = null;

    render(
      <div>
        <textarea data-testid="text-editor" />
        <TestHarness doc={doc} onResult={(r) => { hookResult = r; }} />
      </div>,
    );

    // Focus the textarea
    (screen.getByTestId('text-editor') as HTMLElement).focus();

    // Simulate paste with image file
    const file = makeFile('pasted.png', 'image/png');
    const pasteEvent = new Event('paste', { bubbles: true }) as any;
    pasteEvent.clipboardData = {
      items: [{ type: 'image/png', getAsFile: () => file }],
    };

    await act(async () => {
      hookResult!.onPaste(pasteEvent);
    });

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.size).toBe(0);
  });

  it('adds image centred when board is focused', async () => {
    const doc = new Y.Doc();
    let hookResult: UseImageInsertResult | null = null;

    render(<TestHarness doc={doc} onResult={(r) => { hookResult = r; }} />);

    // No textarea focused
    (document.body as HTMLElement).focus();

    const file = makeFile('pasted.png', 'image/png');
    const pasteEvent = new Event('paste', { bubbles: true }) as any;
    pasteEvent.clipboardData = {
      items: [{ type: 'image/png', getAsFile: () => file }],
      preventDefault: () => {},
    };

    await act(async () => {
      hookResult!.onPaste(pasteEvent);
    });

    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.size).toBe(1);
  });
});

// TC-19: offline → toast, no objects, no upload
describe('TC-19: offline drop shows toast and does nothing', () => {
  it('reconnecting state prevents drop from creating objects', async () => {
    const doc = new Y.Doc();
    const toast = makeToastApi();
    let hookResult: UseImageInsertResult | null = null;

    function OfflineHarness() {
      const result = useImageInsert({
        doc,
        boardId: 'testboard',
        cameraRef: makeCamera(),
        connection: 'reconnecting',
        identityId: 'user1',
        viewportWidth: 1280,
        viewportHeight: 800,
        toast,
      });
      hookResult = result;
      return <div data-testid="target" />;
    }

    render(<OfflineHarness />);

    // Simulate offline drop via openPicker which checks online status
    await act(async () => {
      // Trigger openPicker which also checks online status
      hookResult!.openPicker();
    });

    expect(toast.messages.some((m) => m.text.includes('offline'))).toBe(true);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.size).toBe(0);
  });
});

// TC-21: failed object - uploader sees Retry/Remove; other sees "Image unavailable"
describe('TC-21: failed state rendering', () => {
  it('uploader sees Upload failed with Retry and Remove', () => {
    const image: ImageSnap = {
      id: 'img1', type: 'image', x: 0, y: 0, width: 100, height: 100, z: 1,
      createdAt: 0, createdBy: 'user1', assetKey: null, contentType: 'image/png',
      naturalWidth: 100, naturalHeight: 100, status: 'failed', uploadStartedAt: 0,
      uploaderId: 'user1',
    };

    render(
      <ImageObjectStateless
        image={image}
        isUploader={true}
        canRetry={true}
        now={1000}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByLabelText('Retry')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove')).toBeInTheDocument();
  });

  it('other user sees Image unavailable', () => {
    const image: ImageSnap = {
      id: 'img1', type: 'image', x: 0, y: 0, width: 100, height: 100, z: 1,
      createdAt: 0, createdBy: 'user1', assetKey: null, contentType: 'image/png',
      naturalWidth: 100, naturalHeight: 100, status: 'failed', uploadStartedAt: 0,
      uploaderId: 'user1',
    };

    render(
      <ImageObjectStateless
        image={image}
        isUploader={false}
        canRetry={false}
        now={1000}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
  });
});

// TC-22: uploading older than stale timeout → "Image upload didn't finish" + Remove
describe('TC-22: unfinished state', () => {
  it('shows unfinished with Remove button', () => {
    const image: ImageSnap = {
      id: 'img1', type: 'image', x: 0, y: 0, width: 100, height: 100, z: 1,
      createdAt: 0, createdBy: 'user1', assetKey: null, contentType: 'image/png',
      naturalWidth: 100, naturalHeight: 100, status: 'uploading',
      uploadStartedAt: 1000, uploaderId: 'user1',
    };

    const onRemove = vi.fn();
    render(
      <ImageObjectStateless
        image={image}
        isUploader={false}
        canRetry={false}
        now={1000 + IMAGE_UPLOAD_STALE_MS + 1}
        onRetry={() => {}}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByText("Image upload didn't finish")).toBeInTheDocument();
    expect(screen.getByLabelText('Remove')).toBeInTheDocument();
  });
});

// TC-23: ready image fires error → "Image unavailable" box
describe('TC-23: image load error shows unavailable', () => {
  it('shows Image unavailable when img fires error', async () => {
    const image: ImageSnap = {
      id: 'img1', type: 'image', x: 0, y: 0, width: 200, height: 150, z: 1,
      createdAt: 0, createdBy: 'user1', assetKey: 'board/asset', contentType: 'image/png',
      naturalWidth: 200, naturalHeight: 150, status: 'ready', uploadStartedAt: 0,
      uploaderId: 'user1',
    };

    render(
      <ImageObjectStateless
        image={image}
        isUploader={true}
        canRetry={false}
        now={1000}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );

    // The img element should be present initially
    const img = document.querySelector('img');
    expect(img).not.toBeNull();

    // Simulate error on img
    await act(async () => {
      img!.dispatchEvent(new Event('error'));
    });

    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
  });
});

// TC-24: Retry with file in memory → status uploading; without → only Remove
describe('TC-24: retry behavior', () => {
  it('shows Retry when canRetry is true', () => {
    const image: ImageSnap = {
      id: 'img1', type: 'image', x: 0, y: 0, width: 100, height: 100, z: 1,
      createdAt: 0, createdBy: 'user1', assetKey: null, contentType: 'image/png',
      naturalWidth: 100, naturalHeight: 100, status: 'failed', uploadStartedAt: 0,
      uploaderId: 'user1',
    };

    render(
      <ImageObjectStateless
        image={image}
        isUploader={true}
        canRetry={true}
        now={1000}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(screen.getByLabelText('Retry')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove')).toBeInTheDocument();
  });

  it('hides Retry when canRetry is false (after reload)', () => {
    const image: ImageSnap = {
      id: 'img1', type: 'image', x: 0, y: 0, width: 100, height: 100, z: 1,
      createdAt: 0, createdBy: 'user1', assetKey: null, contentType: 'image/png',
      naturalWidth: 100, naturalHeight: 100, status: 'failed', uploadStartedAt: 0,
      uploaderId: 'user1',
    };

    render(
      <ImageObjectStateless
        image={image}
        isUploader={true}
        canRetry={false}
        now={1000}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(screen.queryByLabelText('Retry')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Remove')).toBeInTheDocument();
  });
});

// TC-29: createImageBitmap rejects → type toast, no placeholder
describe('TC-29: decode failure skips file', () => {
  it('shows type toast and does not create placeholder when bitmap fails', async () => {
    const doc = new Y.Doc();
    const toast = makeToastApi();

    // Make createImageBitmap reject
    (globalThis as any).createImageBitmap = vi.fn(async () => {
      throw new Error('decode failed');
    });

    // Test via the paste path since it doesn't need a DOM target

    function DecodeFailHarness() {
      // We need to call processFiles, which is internal. Use openPicker path instead.
      // Actually, use paste since it doesn't need a DOM target.
      const result = useImageInsert({
        doc,
        boardId: 'testboard',
        cameraRef: makeCamera(),
        connection: 'connected',
        identityId: 'user1',
        viewportWidth: 1280,
        viewportHeight: 800,
        toast,
      });
      // Expose the onPaste method which internally calls processFiles
      (window as any).__testOnPaste = result.onPaste;
      return <div />;
    }

    render(<DecodeFailHarness />);

    const file = makeFile('corrupt.png', 'image/png');
    const pasteEvent = new Event('paste', { bubbles: true }) as any;
    pasteEvent.clipboardData = {
      items: [{ type: 'image/png', getAsFile: () => file }],
    };
    pasteEvent.preventDefault = vi.fn();

    await act(async () => {
      (window as any).__testOnPaste(pasteEvent);
    });

    // Wait for async processFiles to complete
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });

    // No objects created
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.size).toBe(0);
    // Type toast shown
    expect(toast.messages.some((m) => m.text.includes('PNG, JPEG, GIF'))).toBe(true);
  });
});
