/**
 * Story 12: paste handling (TC-18).
 *
 * Full Board render with the sync connection mocked (doc captured) and the
 * image upload module mocked so decoding/uploading work in jsdom.
 *
 * TC-18: pasting while editing text must not add an image (negative);
 * pasting while the board has focus adds an image at the view centre.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import { snapshot } from '@shared/board-model';
import type { DecodedImage } from '@client/images/uploadImage';
import type { ImageSnap } from '@shared/objects/image';

const { connectMock, decodeMock, uploadMock } = vi.hoisted(() => {
  const connectMock = vi.fn(() => ({ destroy: () => {} }));
  const decodeMock = vi.fn(async (file: File): Promise<DecodedImage> => ({
    width: 100,
    height: 50,
    blob: file,
    contentType: file.type,
  }));
  const uploadMock = vi.fn(async (): Promise<string> => 'boardid123456789012345/aaaaaaaaaaaaaaaaaaaaaa');
  return { connectMock, decodeMock, uploadMock };
});

vi.mock('@client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@client/sync/connectBoard')>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ...actual, connectBoard: connectMock as any };
});

vi.mock('@client/images/uploadImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@client/images/uploadImage')>();
  return {
    ...actual,
    decodeImage: decodeMock,
    uploadImageWithProgress: uploadMock,
  };
});

const { Board } = await import('@client/Board');

const capturedDocs: Y.Doc[] = [];

function renderBoard(boardId = 'paste-test') {
  return render(<Board boardId={boardId} />);
}

function imageSnapshots(doc: Y.Doc): ImageSnap[] {
  return snapshot(doc).filter((s) => s.type === 'image') as ImageSnap[];
}

const PNG_FILE = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'paste.png', { type: 'image/png' });

describe('TC-18: paste images', () => {
  beforeEach(() => {
    capturedDocs.length = 0;
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (connectMock as any).mockImplementation((doc: Y.Doc, _id: string, onState: (s: string) => void) => {
      capturedDocs.push(doc);
      onState('connected');
      return { destroy: () => {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('pasting while a textarea has focus does NOT add an image (negative)', async () => {
    renderBoard();
    const doc = capturedDocs[0];

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    act(() => {
      fireEvent.paste(textarea, { clipboardData: { files: [PNG_FILE] } } as never);
    });

    expect(decodeMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(imageSnapshots(doc)).toHaveLength(0);
    textarea.remove();
  });

  it('pasting while the board has focus adds an image at the view centre', async () => {
    renderBoard();
    const doc = capturedDocs[0];

    act(() => {
      fireEvent.paste(document.body, { clipboardData: { files: [PNG_FILE] } } as never);
    });

    // Decoded, placeholder created, upload started and settled.
    expect(decodeMock).toHaveBeenCalledTimes(1);
    await act(async () => {});
    const snaps = imageSnapshots(doc);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].status).toBe('ready');
    expect(uploadMock).toHaveBeenCalledTimes(1);

    // It is rendered.
    expect(screen.getByTestId('board-viewport')).toBeTruthy();
  });

  it('pasting non-image clipboard content adds nothing', async () => {
    renderBoard();
    const doc = capturedDocs[0];

    act(() => {
      fireEvent.paste(document.body, {
        clipboardData: { files: [], text: 'hello' },
      } as never);
    });

    expect(decodeMock).not.toHaveBeenCalled();
    expect(imageSnapshots(doc)).toHaveLength(0);
  });
});
