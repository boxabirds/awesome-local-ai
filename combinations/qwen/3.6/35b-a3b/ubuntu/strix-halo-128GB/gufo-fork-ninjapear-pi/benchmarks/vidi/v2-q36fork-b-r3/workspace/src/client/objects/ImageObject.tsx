/** ImageObject rendering — placeholder, ready, failed, unfinished states for story 12 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { DisplayStatus } from '@shared/objects/image';
import { IMAGE_MIN_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '@shared/config';

export interface ImageSnap {
  id: string;
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: 'uploading' | 'ready' | 'failed';
  uploadStartedAt: number;
  uploaderId: string;
  z: number;
  createdAt: number;
}

interface ImageObjectProps {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  onRetry(): void;
  onRemove(): void;
  now: number;
}

/** Derive display status (same logic as in image.ts) */
function getDisplayStatus(img: ImageSnap, now: number): DisplayStatus {
  if (img.status === 'ready') return 'ready';
  if (img.status === 'failed') return 'failed';
  if (now - img.uploadStartedAt >= IMAGE_UPLOAD_STALE_MS) {
    return 'unfinished';
  }
  return 'uploading';
}

export function ImageObject(props: ImageObjectProps) {
  const { image, isUploader, progress, canRetry, onRetry, onRemove, now } = props;
  const [loadError, setLoadError] = useState(false);
  const displayStatus = getDisplayStatus(image, now);

  // Reset loadError when assetKey changes
  useEffect(() => {
    setLoadError(false);
  }, [image.assetKey]);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
    overflow: 'hidden',
  };

  // ─── Uploading state ──────────────────────────────────────────────
  if (displayStatus === 'uploading') {
    return (
      <div
        data-image-id={image.id}
        style={{
          ...style,
          background: '#e0e0e0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Image icon */}
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#999"
          strokeWidth="1.5"
          style={{ marginBottom: 8 }}
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
        {isUploader && progress !== undefined ? (
          <>
            <span style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
              {progress}%
            </span>
            <div
              style={{
                width: '80%',
                height: 6,
                background: '#ccc',
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: '#2196F3',
                  borderRadius: 3,
                  transition: 'width 0.2s',
                }}
              />
            </div>
          </>
        ) : (
          <span style={{ fontSize: 12, color: '#999' }}>Uploading…</span>
        )}
      </div>
    );
  }

  // ─── Unfinished state ─────────────────────────────────────────────
  if (displayStatus === 'unfinished') {
    return (
      <div
        data-image-id={image.id}
        style={{
          ...style,
          background: '#f5f5f5',
          border: '1px solid #ddd',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 12, color: '#999' }}>Image upload didn't finish</span>
        <button
          aria-label="Remove"
          onClick={onRemove}
          style={{
            padding: '4px 12px',
            fontSize: 12,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Remove
        </button>
      </div>
    );
  }

  // ─── Failed state ─────────────────────────────────────────────────
  if (displayStatus === 'failed') {
    if (isUploader) {
      return (
        <div
          data-image-id={image.id}
          style={{
            ...style,
            background: '#ffebee',
            border: '2px solid #f44336',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 12, color: '#c62828', fontWeight: 500 }}>
            Upload failed
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {canRetry && (
              <button
                aria-label="Retry upload"
                onClick={onRetry}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  background: '#2196F3',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            )}
            <button
              aria-label="Remove"
              onClick={onRemove}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                background: '#fff',
                border: '1px solid #ccc',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Remove
            </button>
          </div>
        </div>
      );
    }
    // Other participants see "Image unavailable" for failed uploads
    return renderUnavailable(image, onRemove);
  }

  // ─── Ready state ──────────────────────────────────────────────────
  if (image.assetKey && !loadError) {
    return (
      <div
        data-image-id={image.id}
        style={{
          ...style,
          cursor: 'default',
        }}
      >
        <img
          src={`/api/assets/${image.assetKey}`}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => setLoadError(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
        />
      </div>
    );
  }

  // Load error → show unavailable
  return renderUnavailable(image, onRemove);
}

/** Shared rendering of "Image unavailable" state */
function renderUnavailable(image: ImageSnap, onRemove?: () => void): React.ReactElement {
  return (
    <div
      data-image-id={image.id}
      style={{
        position: 'absolute',
        left: image.x,
        top: image.y,
        width: image.width,
        height: image.height,
        background: '#f5f5f5',
        border: '1px solid #ddd',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#bbb"
        strokeWidth="1.5"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="9" y1="9" x2="15" y2="15" />
        <line x1="15" y1="9" x2="9" y2="15" />
      </svg>
      <span style={{ fontSize: 11, color: '#999' }}>Image unavailable</span>
    </div>
  );
}
