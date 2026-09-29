/**
 * Image object renderer (story 12, image.object).
 *
 * Renders an image in one of its display states:
 *  - uploading: grey box with progress (uploader) or "Uploading…" (others)
 *  - ready: <img> with lazy loading
 *  - failed: uploader → "Upload failed" + Retry/Remove; others → "Image unavailable"
 *  - unfinished: "Image upload didn't finish" + Remove (anyone)
 *  - img load error: "Image unavailable" box
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { JSX } from 'react';
import type { ObjectProps } from './registry';
import type { ImageSnap, DisplayStatus } from '../../shared/objects/image';
import { displayStatus } from '../../shared/objects/image';

export interface ImageObjectProps {
  image: ImageSnap;
  isUploader: boolean;
  /** Upload progress fraction (0..1), uploader only. */
  progress?: number;
  /** Whether Retry is available (file still in memory). */
  canRetry: boolean;
  /** Current time (epoch ms) for displayStatus calculation. */
  now: number;
  onRetry(): void;
  onRemove(): void;
}

const GREY_BG = '#E8ECF1';
const RED_BORDER = '#E53935';

/** A small broken-image icon (SVG). */
function BrokenImageIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#fff" stroke="#9E9E9E" strokeWidth="1.5" />
      <path d="M3 17l5-5 3 3 5-5 5 5" stroke="#9E9E9E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8.5" cy="8.5" r="1.5" fill="#9E9E9E" />
      <line x1="14" y1="3" x2="21" y2="10" stroke={RED_BORDER} strokeWidth="2" />
      <line x1="21" y1="3" x2="14" y2="10" stroke={RED_BORDER} strokeWidth="2" />
    </svg>
  );
}

/** A small image icon (for the uploading state). */
function ImageIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#fff" stroke="#9E9E9E" strokeWidth="1.5" />
      <path d="M3 17l5-5 3 3 5-5 5 5" stroke="#9E9E9E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8.5" cy="8.5" r="1.5" fill="#9E9E9E" />
    </svg>
  );
}

/**
 * Render the appropriate state for the image object.
 */
export function ImageObject(props: ImageObjectProps): JSX.Element {
  const { image, isUploader, progress, canRetry, now, onRetry, onRemove } = props;
  const [loadError, setLoadError] = useState(false);

  // Reset loadError when assetKey changes (a new upload might succeed).
  useEffect(() => {
    setLoadError(false);
  }, [image.assetKey]);

  const status: DisplayStatus = displayStatus(image, now);
  const w = image.width;
  const h = image.height;

  // Helper: centred content in a grey box.
  const greyBox = (content: React.ReactNode, extraStyle?: React.CSSProperties): JSX.Element => (
    <div
      data-testid="image-object"
      style={{
        width: w,
        height: h,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: GREY_BG,
        borderRadius: '4px',
        overflow: 'hidden',
        position: 'relative',
        ...extraStyle,
      }}
    >
      {content}
    </div>
  );

  // Uploading state.
  if (status === 'uploading') {
    if (isUploader) {
      const pct = Math.round((progress ?? 0) * 100);
      return greyBox(
        <>
          <ImageIcon />
          <div
            style={{
              width: '80%',
              height: 4,
              background: '#ccc',
              borderRadius: 2,
              marginTop: 8,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: '#4285F4',
                transition: 'width 0.2s',
              }}
            />
          </div>
          <span style={{ fontSize: 12, marginTop: 4, color: '#555' }}>{pct}%</span>
        </>,
      );
    }
    // Other participants see "Uploading…".
    return greyBox(
      <>
        <ImageIcon />
        <span style={{ fontSize: 12, marginTop: 4, color: '#555' }}>Uploading…</span>
      </>,
    );
  }

  // Ready state.
  if (status === 'ready') {
    if (loadError) {
      return greyBox(
        <>
          <BrokenImageIcon />
          <span style={{ fontSize: 12, marginTop: 4, color: '#555' }}>Image unavailable</span>
        </>,
      );
    }
    if (image.assetKey === null) {
      // Should not happen, but guard against it.
      return greyBox(<span style={{ fontSize: 12, color: '#555' }}>Image unavailable</span>);
    }
    return (
      <img
        src={`/api/assets/${image.assetKey}`}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        data-testid="image-object"
        onError={() => setLoadError(true)}
        style={{
          width: w,
          height: h,
          objectFit: 'fill',
          borderRadius: '4px',
          display: 'block',
        }}
      />
    );
  }

  // Failed state.
  if (status === 'failed') {
    if (isUploader) {
      return greyBox(
        <>
          <span style={{ fontSize: 13, color: RED_BORDER, fontWeight: 500 }}>Upload failed</span>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {canRetry && (
              <button
                type="button"
                data-testid="image-retry"
                onClick={onRetry}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: '1px solid #ccc',
                  background: '#fff',
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            )}
            <button
              type="button"
              data-testid="image-remove"
              onClick={onRemove}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                borderRadius: 4,
                border: '1px solid #ccc',
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              Remove
            </button>
          </div>
        </>,
        { border: `2px solid ${RED_BORDER}` },
      );
    }
    // Other participants see "Image unavailable".
    return greyBox(
      <>
        <BrokenImageIcon />
        <span style={{ fontSize: 12, marginTop: 4, color: '#555' }}>Image unavailable</span>
      </>,
    );
  }

  // Unfinished state (uploading longer than IMAGE_UPLOAD_STALE_MS).
  if (status === 'unfinished') {
    return greyBox(
      <>
        <span style={{ fontSize: 12, color: '#555', textAlign: 'center', padding: '0 8px' }}>
          Image upload didn't finish
        </span>
        <button
          type="button"
          data-testid="image-remove"
          onClick={onRemove}
          style={{
            padding: '4px 12px',
            fontSize: 12,
            borderRadius: 4,
            border: '1px solid #ccc',
            background: '#fff',
            cursor: 'pointer',
            marginTop: 8,
          }}
        >
          Remove
        </button>
      </>,
    );
  }

  // Fallback (should not be reached).
  return greyBox(<span style={{ fontSize: 12, color: '#555' }}>Image unavailable</span>);
}

/**
 * The registry wrapper component. Receives ObjectProps and extracts the
 * image-specific fields.
 */
export function ImageObjectWrapper(props: ObjectProps & {
  isUploader?: boolean;
  progress?: number;
  canRetry?: boolean;
  now?: number;
  onRetry?: (id: string) => void;
  onRemove?: (id: string) => void;
}): JSX.Element {
  const image = props.obj as unknown as ImageSnap;
  return (
    <ImageObject
      image={image}
      isUploader={props.isUploader ?? false}
      progress={props.progress}
      canRetry={props.canRetry ?? false}
      now={props.now ?? Date.now()}
      onRetry={() => props.onRetry?.(image.id)}
      onRemove={() => props.onRemove?.(image.id)}
    />
  );
}
