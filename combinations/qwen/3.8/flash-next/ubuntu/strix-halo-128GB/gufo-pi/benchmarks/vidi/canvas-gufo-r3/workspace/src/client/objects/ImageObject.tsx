import React, { useState, useEffect, useRef } from 'react';
import type { ImageSnap, DisplayStatus } from '@shared/objects/image';
import { displayStatus } from '@shared/objects/image';

export interface ImageObjectProps {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
}

function assetUrl(assetKey: string): string {
  return `/api/assets/${assetKey}`;
}

export function ImageObject(props: ImageObjectProps): React.JSX.Element {
  const { image, isUploader, progress, canRetry, now, onRetry, onRemove } = props;
  const status: DisplayStatus = displayStatus(image, now);
  const [loadError, setLoadError] = useState(false);
  const lastAssetKeyRef = useRef<string | null>(null);

  // Reset loadError when assetKey changes (new image loaded)
  if (image.assetKey !== lastAssetKeyRef.current) {
    lastAssetKeyRef.current = image.assetKey;
    if (loadError) setLoadError(false);
  }

  const style: React.CSSProperties = {
    position: 'absolute',
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
    overflow: 'hidden',
  };

  if (status === 'uploading') {
    if (isUploader) {
      const pct = progress != null ? Math.round(progress * 100) : 0;
      return (
        <div
          data-testid="image-placeholder"
          data-image-id={image.id}
          style={{
            ...style,
            background: '#e0e0e0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #bdbdbd',
          }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="#757575" strokeWidth="1.5" />
            <circle cx="8.5" cy="8.5" r="1.5" fill="#757575" />
            <path d="M21 15l-5-5L5 21" stroke="#757575" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div style={{ marginTop: 8, fontSize: '12px', color: '#616161' }}>
            <div style={{ width: '80%', height: '6px', background: '#bdbdbd', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#1976D2', transition: 'width 0.2s' }} />
            </div>
            <span>{pct}%</span>
          </div>
        </div>
      );
    } else {
      return (
        <div
          data-testid="image-placeholder"
          data-image-id={image.id}
          style={{
            ...style,
            background: '#e0e0e0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #bdbdbd',
          }}
        >
          <span style={{ fontSize: '14px', color: '#616161' }}>Uploading…</span>
        </div>
      );
    }
  }

  if (status === 'failed') {
    if (isUploader) {
      return (
        <div
          data-testid="image-failed"
          data-image-id={image.id}
          style={{
            ...style,
            background: '#fafafa',
            border: '2px solid #d32f2f',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: '14px', color: '#d32f2f' }}>Upload failed</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            {canRetry && (
              <button
                type="button"
                data-testid="image-retry"
                onClick={(e) => { e.stopPropagation(); onRetry(); }}
                style={{
                  padding: '4px 12px',
                  border: '1px solid #1976D2',
                  borderRadius: '4px',
                  background: '#E3F2FD',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Retry
              </button>
            )}
            <button
              type="button"
              data-testid="image-remove"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              style={{
                padding: '4px 12px',
                border: '1px solid #757575',
                borderRadius: '4px',
                background: '#f5f5f5',
                cursor: 'pointer',
                fontSize: '13px',
              }}
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
            ...style,
            background: '#e0e0e0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #bdbdbd',
          }}
        >
          <BrokenImageIcon />
          <span style={{ fontSize: '13px', color: '#616161', marginLeft: '4px' }}>Image unavailable</span>
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
          ...style,
          background: '#e0e0e0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          border: '1px solid #bdbdbd',
        }}
      >
        <span style={{ fontSize: '13px', color: '#616161' }}>Image upload didn&apos;t finish</span>
        <button
          type="button"
          data-testid="image-remove"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{
            padding: '4px 12px',
            border: '1px solid #757575',
            borderRadius: '4px',
            background: '#f5f5f5',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          Remove
        </button>
      </div>
    );
  }

  // status === 'ready'
  if (loadError || !image.assetKey) {
    return (
      <div
        data-testid="image-unavailable"
        data-image-id={image.id}
        style={{
          ...style,
          background: '#e0e0e0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid #bdbdbd',
        }}
      >
        <BrokenImageIcon />
        <span style={{ fontSize: '13px', color: '#616161', marginLeft: '4px' }}>Image unavailable</span>
      </div>
    );
  }

  return (
    <div
      data-testid="image-object"
      data-image-id={image.id}
      style={style}
      role="img"
      aria-label="Image"
    >
      <img
        src={assetUrl(image.assetKey)}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        onError={() => setLoadError(true)}
      />
    </div>
  );
}

function BrokenImageIcon(): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" stroke="#9e9e9e" strokeWidth="1.5" />
      <line x1="4" y1="4" x2="20" y2="20" stroke="#9e9e9e" strokeWidth="1.5" />
      <line x1="20" y1="4" x2="4" y2="20" stroke="#9e9e9e" strokeWidth="1.5" />
    </svg>
  );
}
