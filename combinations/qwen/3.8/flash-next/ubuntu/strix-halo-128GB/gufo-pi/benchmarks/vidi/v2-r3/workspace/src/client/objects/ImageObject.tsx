/**
 * ImageObject: renders image states (uploading, ready, failed, unfinished, unavailable) (story 12).
 */
import React, { useState, useEffect, useRef } from 'react';
import type { ImageSnap } from '../../shared/objects/image';
import { displayStatus } from '../../shared/objects/image';

export interface ImageObjectProps {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
}

export function ImageObject({
  image,
  isUploader,
  progress,
  canRetry,
  now,
  onRetry,
  onRemove,
}: ImageObjectProps) {
  const [loadError, setLoadError] = useState(false);
  const prevAssetKeyRef = useRef(image.assetKey);

  // Reset load error when assetKey changes
  useEffect(() => {
    if (image.assetKey !== prevAssetKeyRef.current) {
      setLoadError(false);
      prevAssetKeyRef.current = image.assetKey;
    }
  }, [image.assetKey]);

  const status = displayStatus(image, now);

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
  };

  if (status === 'uploading') {
    return (
      <div
        data-testid="image-placeholder"
        data-image-id={image.id}
        style={{
          ...baseStyle,
          backgroundColor: '#e0e0e0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 4,
        }}
      >
        {isUploader ? (
          <>
            {/* Image icon */}
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" style={{ opacity: 0.5, marginBottom: 4 }}>
              <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
              <path d="M21 15l-5-5L5 21" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
            {/* Progress bar */}
            <div style={{ width: '80%', height: 6, backgroundColor: '#bdbdbd', borderRadius: 3, overflow: 'hidden' }}>
              <div
                data-testid="upload-progress-bar"
                style={{
                  width: `${Math.round((progress ?? 0) * 100)}%`,
                  height: '100%',
                  backgroundColor: '#1976D2',
                  transition: 'width 0.2s',
                }}
              />
            </div>
            <span data-testid="upload-progress-text" style={{ fontSize: 11, color: '#757575', marginTop: 4 }}>
              {Math.round((progress ?? 0) * 100)}%
            </span>
          </>
        ) : (
          <span style={{ fontSize: 13, color: '#757575' }}>Uploading…</span>
        )}
      </div>
    );
  }

  if (status === 'ready') {
    if (loadError) {
      return (
        <div
          data-testid="image-unavailable"
          data-image-id={image.id}
          style={{
            ...baseStyle,
            backgroundColor: '#e0e0e0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" style={{ opacity: 0.5, marginBottom: 4 }}>
            <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
            <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span style={{ fontSize: 12, color: '#757575' }}>Image unavailable</span>
        </div>
      );
    }

    return (
      <div
        data-testid="image-object"
        data-image-id={image.id}
        role="img"
        aria-label="Image"
        style={baseStyle}
      >
        <img
          src={`/api/assets/${image.assetKey}`}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          onError={() => setLoadError(true)}
        />
      </div>
    );
  }

  if (status === 'failed') {
    if (isUploader) {
      return (
        <div
          data-testid="image-failed"
          data-image-id={image.id}
          style={{
            ...baseStyle,
            backgroundColor: '#fce4ec',
            border: '2px solid #E53935',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
          }}
        >
          <span style={{ fontSize: 13, color: '#c62828', marginBottom: 8 }}>Upload failed</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {canRetry && (
              <button
                type="button"
                data-testid="image-retry"
                onClick={(e) => { e.stopPropagation(); onRetry(); }}
                style={{ padding: '4px 12px', fontSize: 12, border: '1px solid #1976D2', borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer' }}
              >
                Retry
              </button>
            )}
            <button
              type="button"
              data-testid="image-remove"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              style={{ padding: '4px 12px', fontSize: 12, border: '1px solid #999', borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer' }}
            >
              Remove
            </button>
          </div>
        </div>
      );
    } else {
      return (
        <div
          data-testid="image-unavailable"
          data-image-id={image.id}
          style={{
            ...baseStyle,
            backgroundColor: '#e0e0e0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" style={{ opacity: 0.5, marginBottom: 4 }}>
            <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
            <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span style={{ fontSize: 12, color: '#757575' }}>Image unavailable</span>
        </div>
      );
    }
  }

  if (status === 'unfinished') {
    return (
      <div
        data-testid="image-unfinished"
        data-image-id={image.id}
        style={{
          ...baseStyle,
          backgroundColor: '#e0e0e0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 4,
        }}
      >
        <span style={{ fontSize: 13, color: '#757575', marginBottom: 8 }}>Image upload didn't finish</span>
        <button
          type="button"
          data-testid="image-remove"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{ padding: '4px 12px', fontSize: 12, border: '1px solid #999', borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer' }}
        >
          Remove
        </button>
      </div>
    );
  }

  return null;
}
