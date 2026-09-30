/**
 * ImageObject: renders an image in four states (story 12).
 * - uploading: grey placeholder with spinner overlay
 * - ready: <img> with objectFit:'contain'
 * - failed: red-tinted placeholder with "Retry" button
 * - unfinished / unavailable: dark placeholder with message
 */

import React, { useRef, useEffect, useState } from 'react';

import type { ImageSnap, DisplayStatus } from '../../shared/objects/image';
import { displayStatus } from '../../shared/objects/image';
import type { Camera } from '../canvas/camera';

interface ImageObjectProps {
  snap: ImageSnap;
  camera: Camera;
  isSelected: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onRetry?: (id: string) => void;
}

export function ImageObject({ snap, isSelected, onPointerDown, onRetry }: ImageObjectProps) {
  const now = Date.now();
  const status: DisplayStatus = displayStatus(snap, now);

  const worldWidth = snap.width;
  const worldHeight = snap.height;

  return (
    <div
      data-testid={`image-${snap.id}`}
      data-image-status={status}
      style={{
        position: 'absolute',
        left: snap.x,
        top: snap.y,
        width: worldWidth,
        height: worldHeight,
        pointerEvents: 'none',
        zIndex: Math.round(snap.z),
        outline: isSelected ? '2px solid #4A90D9' : undefined,
        outlineOffset: 0,
        borderRadius: 2,
        overflow: 'hidden',
      }}
      onPointerDown={onPointerDown}
    >
      {status === 'ready' && snap.assetKey && (
        <ReadyImage assetKey={snap.assetKey} width={worldWidth} height={worldHeight} />
      )}
      {status === 'uploading' && <UploadingPlaceholder width={worldWidth} height={worldHeight} />}
      {status === 'failed' && (
        <FailedPlaceholder width={worldWidth} height={worldHeight} onRetry={() => onRetry?.(snap.id)} />
      )}
      {(status === 'unfinished') && (
        <UnfinishedPlaceholder width={worldWidth} height={worldHeight} />
      )}
    </div>
  );
}

function ReadyImage({ assetKey, width, height }: { assetKey: string; width: number; height: number }) {
  const url = `/api/assets/${assetKey}`;
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const blobCacheRef = useRef<string | null>(null);

  useEffect(() => {
    // Fetch the image as a blob and create an object URL (CSP-safe)
    if (blobCacheRef.current) {
      setImgSrc(blobCacheRef.current);
      return;
    }

    let cancelled = false;
    fetch(url)
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        blobCacheRef.current = objectUrl;
        setImgSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  // Clean up object URL on unmount
  useEffect(() => {
    return () => {
      if (blobCacheRef.current) {
        URL.revokeObjectURL(blobCacheRef.current);
      }
    };
  }, []);

  if (error) {
    return <UnavailablePlaceholder width={width} height={height} />;
  }

  if (!imgSrc) {
    return <UploadingPlaceholder width={width} height={height} />;
  }

  return (
    <img
      src={imgSrc}
      alt=""
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        display: 'block',
        pointerEvents: 'auto',
      }}
      draggable={false}
    />
  );
}

function UploadingPlaceholder({ width, height }: { width: number; height: number }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#e0e0e0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        data-testid="image-spinner"
        style={{
          width: Math.min(32, width / 4, height / 4),
          height: Math.min(32, width / 4, height / 4),
          border: '3px solid #bbb',
          borderTopColor: '#666',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
    </div>
  );
}

function FailedPlaceholder({ height, onRetry }: { width: number; height: number; onRetry: () => void }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#f5e0e0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
      }}
    >
      <span style={{ fontSize: Math.min(14, height / 6), color: '#c00' }}>Upload failed</span>
      <button
        data-testid="image-retry"
        onClick={(e) => {
          e.stopPropagation();
          onRetry();
        }}
        style={{
          fontSize: Math.min(12, height / 8),
          padding: '2px 8px',
          cursor: 'pointer',
          pointerEvents: 'auto',
        }}
      >
        Retry
      </button>
    </div>
  );
}

function UnfinishedPlaceholder({ height }: { width: number; height: number }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#3a3a3a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span style={{ fontSize: Math.min(14, height / 6), color: '#ccc' }}>
        Upload incomplete — refresh to retry
      </span>
    </div>
  );
}

function UnavailablePlaceholder({ height }: { width: number; height: number }) {
  return (
    <div
      data-testid="image-unavailable"
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#4a4a4a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span style={{ fontSize: Math.min(14, height / 6), color: '#ccc' }}>
        Image unavailable
      </span>
    </div>
  );
}
