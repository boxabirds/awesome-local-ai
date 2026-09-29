/**
 * Image objects and every state a user can see (story 12, image.object).
 *
 * `ImageObject` is presentational — it renders from a snapshot plus the few
 * session-local facts the doc cannot know (am I the uploader? how far is my
 * upload? is the file still in memory?). `ImageBoardObject` is the registry entry
 * that supplies those facts, so the generic move/resize/delete machinery keeps
 * working unchanged.
 *
 * The image itself is served from R2 with a year-long immutable cache and is
 * never interpreted as anything but an image; `draggable={false}` keeps the
 * browser from starting a native image drag over the board.
 */
import { useEffect, useState, useSyncExternalStore, type JSX } from 'react';
import { IMAGE_CLOCK_TICK_MS } from '../../shared/config';
import { displayStatus, type DisplayStatus, type ImageSnap } from '../../shared/objects/image';
import { deleteObjects } from '../../shared/board-model';
import { assetUrlFor } from '../images/uploadImage';
import { boardIdFromPath } from '../router';
import { SESSION_IDENTITY } from '../sync/sessionIdentity';
import {
  canRetryImage,
  forgetImages,
  progressOf,
  retryUpload,
  subscribeUploads,
  uploadVersion,
} from '../images/uploadQueue';
import type { ObjectProps } from './registry';

type RenderedStatus = DisplayStatus | 'missing';

export interface ImageObjectProps {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
  selected?: boolean;
  onObjectPointerDown?(e: React.PointerEvent, id: string): void;
}

/** One shared 30 s heartbeat for every placeholder that is still waiting. */
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function useImageClock(active: boolean): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const notify = () => tick((n) => n + 1);
    clockListeners.add(notify);
    if (clockTimer === null) {
      clockTimer = setInterval(() => {
        for (const listener of [...clockListeners]) listener();
      }, IMAGE_CLOCK_TICK_MS);
    }
    return () => {
      clockListeners.delete(notify);
      if (clockListeners.size === 0 && clockTimer !== null) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
    };
  }, [active]);
  return Date.now();
}

function percent(progress: number | undefined): number {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress * 100)));
}

function ImageIcon(): JSX.Element {
  return (
    <svg
      className="image-icon"
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M4 17l5-5 4 4 3-2.5 4 3.5" />
    </svg>
  );
}

/** Grey box used for every non-ready state. */
function Placeholder(props: {
  testid: string;
  className: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={`image-placeholder ${props.className}`} data-testid={props.testid}>
      <ImageIcon />
      <div className="image-placeholder-body">{props.children}</div>
    </div>
  );
}

function ControlButton(props: {
  label: string;
  onClick(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="image-control"
      aria-label={props.label}
      data-testid={props.label === 'Retry' ? 'image-retry' : 'image-remove'}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
    >
      {props.label}
    </button>
  );
}

/**
 * Render one image object. The status shown is `displayStatus`, which turns a
 * long-running `uploading` into `unfinished` for everyone.
 */
export function ImageObject(props: ImageObjectProps): JSX.Element {
  const { image, isUploader, progress, canRetry, now } = props;
  const [loadFailed, setLoadFailed] = useState(false);
  // A ready image whose bytes have gone missing is its own state: the upload
  // worked, so blaming it with "failed" (and a Retry that cannot help) would
  // mislead the person who uploaded it.
  const shown: DisplayStatus = displayStatus(image, now);
  const status: RenderedStatus = loadFailed && shown === 'ready' ? 'missing' : shown;
  const width = image.width ?? 0;
  const height = image.height ?? 0;

  // A new asset key means a fresh attempt to load: forget an earlier error.
  const [lastKey, setLastKey] = useState(image.assetKey);
  if (lastKey !== image.assetKey) {
    setLastKey(image.assetKey);
    if (loadFailed) setLoadFailed(false);
  }

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${image.x}px`,
    top: `${image.y}px`,
    width: `${width}px`,
    height: `${height}px`,
    zIndex: image.z,
    pointerEvents: 'auto',
    touchAction: 'none',
  };

  let body: JSX.Element;
  switch (status) {
    case 'uploading':
      body = isUploader ? (
        <Placeholder testid="image-uploading" className="image-placeholder-self">
          <span className="image-status">Uploading…</span>
          <div
            className="image-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent(progress)}
          >
            <div
              className="image-progress-bar"
              style={{ width: `${percent(progress)}%` }}
              data-testid="image-progress-bar"
            />
          </div>
          <span className="image-progress-text" data-testid="image-progress-text">
            {percent(progress)}%
          </span>
        </Placeholder>
      ) : (
        <Placeholder testid="image-uploading-other" className="image-placeholder-other">
          <span className="image-status">Uploading…</span>
        </Placeholder>
      );
      break;
    case 'failed':
      body = isUploader ? (
        <Placeholder testid="image-failed" className="image-placeholder-failed">
          <span className="image-status">Upload failed</span>
          <div className="image-controls">
            {canRetry && <ControlButton label="Retry" onClick={props.onRetry} />}
            <ControlButton label="Remove" onClick={props.onRemove} />
          </div>
        </Placeholder>
      ) : (
        <Placeholder testid="image-unavailable" className="image-placeholder-unavailable">
          <span className="image-status">Image unavailable</span>
        </Placeholder>
      );
      break;
    case 'unfinished':
      body = (
        <Placeholder testid="image-unfinished" className="image-placeholder-unfinished">
          <span className="image-status">Image upload didn&apos;t finish</span>
          <div className="image-controls">
            <ControlButton label="Remove" onClick={props.onRemove} />
          </div>
        </Placeholder>
      );
      break;
    case 'missing':
      body = (
        <Placeholder testid="image-missing" className="image-placeholder-unavailable">
          <span className="image-status">Image unavailable</span>
          <div className="image-controls">
            <ControlButton label="Remove" onClick={props.onRemove} />
          </div>
        </Placeholder>
      );
      break;
    default:
      body = (
        <img
          className="image-content"
          data-testid="image-content"
          src={image.assetKey ? assetUrlFor(image.assetKey) : undefined}
          alt="Image"
          width={width}
          height={height}
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => setLoadFailed(true)}
        />
      );
      break;
  }

  return (
    <div
      className={`image-object${props.selected ? ' image-selected' : ''}`}
      role="group"
      aria-label="Image"
      data-image-id={image.id}
      data-image-status={status}
      data-selected={props.selected ? 'true' : undefined}
      style={style}
      onPointerDown={(e) => {
        props.onObjectPointerDown?.(e, image.id);
      }}
    >
      {body}
    </div>
  );
}

/** Registry component: derives the session-local facts and renders `ImageObject`. */
export function ImageBoardObject(props: ObjectProps): JSX.Element {
  const image = props.obj as unknown as ImageSnap;

  // Progress and Retry come from the upload queue; re-render when they change.
  useSyncExternalStore(subscribeUploads, uploadVersion, uploadVersion);
  const progress = progressOf(image.id) ?? undefined;
  const canRetry = canRetryImage(image.id);
  const isUploader = image.uploaderId === SESSION_IDENTITY;
  const now = useImageClock(image.status === 'uploading');

  return (
    <ImageObject
      image={image}
      isUploader={isUploader}
      progress={progress}
      canRetry={canRetry}
      now={now}
      selected={props.selected}
      onObjectPointerDown={props.onObjectPointerDown}
      onRetry={() => {
        const boardId = boardIdFromPath();
        if (!boardId) return;
        retryUpload(props.doc, boardId, image.id);
      }}
      onRemove={() => {
        forgetImages([image.id]);
        props.undo?.boundary();
        deleteObjects(props.doc, [image.id]);
        props.undo?.boundary();
      }}
    />
  );
}
