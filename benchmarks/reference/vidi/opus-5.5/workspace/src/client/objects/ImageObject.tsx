import {
  createContext,
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { assetUrl } from '../../shared/image-format';
import { displayStatus, isImage, type ImageSnap } from '../../shared/objects/image';
import type { ObjectProps } from './objectTypes';

/** How the image and its placeholder are announced (PRD accessibility). */
export const IMAGE_LABEL = 'Image';
export const UPLOADING_TEXT = 'Uploading…';
export const UPLOAD_FAILED_TEXT = 'Upload failed';
export const IMAGE_UNAVAILABLE_TEXT = 'Image unavailable';
export const UNFINISHED_TEXT = "Image upload didn't finish";
export const RETRY_LABEL = 'Retry';
export const REMOVE_LABEL = 'Remove';
/** While any image is uploading the board re-renders this often, so `unfinished` appears by itself. */
export const IMAGE_CLOCK_TICK_MS = 30_000;
const PERCENT = 100;
/** Selection outline thickness in screen px (kept constant at every zoom). */
const OUTLINE_SCREEN_PX = 2;

export interface ImageObjectProps {
  image: ImageSnap;
  /** This person started the upload (sees progress, and Retry/Remove on failure). */
  isUploader: boolean;
  /** Upload progress 0..1 while this person's upload runs. */
  progress?: number;
  /** The file is still in memory, so Retry can upload it again. */
  canRetry: boolean;
  /** Current time (ms), from the board's image clock. */
  now: number;
  onRetry(): void;
  onRemove(): void;
  /** Hides Retry and Remove while the board cannot be edited. */
  readOnly?: boolean;
}

function PictureIcon() {
  return (
    <svg className="image-object__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="10" r="1.8" fill="currentColor" />
      <path d="M4 17l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function BrokenImageIcon() {
  return (
    <svg className="image-object__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M3 5h8l-2 5 3 3-2 6H3zM13 5h8v14h-7l2-5-3-3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Buttons inside an image must not start the board's select / move gesture. */
function stop(e: ReactPointerEvent) {
  e.stopPropagation();
}

function ActionButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button
      type="button"
      className="image-object__button"
      onPointerDown={stop}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {label}
    </button>
  );
}

/**
 * One image's content by display status (image.object): the picture itself when ready, a grey
 * placeholder with progress while uploading (the uploader sees a percentage, everyone else
 * "Uploading…"), failed / unfinished / unavailable boxes with Retry and Remove as allowed. A
 * picture that fails to load turns into "Image unavailable" locally and tries again when the
 * stored key changes; nothing else on the board is affected (image.unavailable).
 */
export function ImageObject(props: ImageObjectProps) {
  const { image, isUploader, progress, canRetry, now, onRetry, onRemove, readOnly = false } = props;
  const [brokenKey, setBrokenKey] = useState<string | null>(null);
  const status = displayStatus(image, now);

  if (status === 'ready' && image.assetKey && brokenKey !== image.assetKey) {
    const key = image.assetKey;
    return (
      <img
        className="image-object__img"
        data-testid="image-picture"
        src={assetUrl(key)}
        alt={IMAGE_LABEL}
        draggable={false}
        decoding="async"
        loading="lazy"
        onError={() => setBrokenKey(key)}
      />
    );
  }

  if (status === 'uploading') {
    if (!isUploader) {
      return (
        <div className="image-object__box" data-state="uploading">
          <PictureIcon />
          <span className="image-object__text">{UPLOADING_TEXT}</span>
        </div>
      );
    }
    const percent = Math.round((progress ?? 0) * PERCENT);
    return (
      <div className="image-object__box" data-state="uploading">
        <PictureIcon />
        <div
          className="image-object__progress"
          role="progressbar"
          aria-label="Upload progress"
          aria-valuemin={0}
          aria-valuemax={PERCENT}
          aria-valuenow={percent}
        >
          <div className="image-object__progress-bar" style={{ width: `${percent}%` }} />
        </div>
        <span className="image-object__text" data-testid="image-progress">{`${percent}%`}</span>
      </div>
    );
  }

  if (status === 'failed' && isUploader) {
    return (
      <div className="image-object__box image-object__box--failed" data-state="failed">
        <span className="image-object__text">{UPLOAD_FAILED_TEXT}</span>
        {!readOnly && (
          <div className="image-object__actions">
            {canRetry && <ActionButton label={RETRY_LABEL} onClick={onRetry} />}
            <ActionButton label={REMOVE_LABEL} onClick={onRemove} />
          </div>
        )}
      </div>
    );
  }

  if (status === 'unfinished') {
    return (
      <div className="image-object__box" data-state="unfinished">
        <BrokenImageIcon />
        <span className="image-object__text">{UNFINISHED_TEXT}</span>
        {!readOnly && (
          <div className="image-object__actions">
            <ActionButton label={REMOVE_LABEL} onClick={onRemove} />
          </div>
        )}
      </div>
    );
  }

  // Failed (seen by others), or a stored image that could not be loaded.
  return (
    <div className="image-object__box" data-state="unavailable">
      <BrokenImageIcon />
      <span className="image-object__text">{IMAGE_UNAVAILABLE_TEXT}</span>
    </div>
  );
}

/** What the board gives every image (who is looking, upload progress, Retry and Remove). */
export interface ImageBoardState {
  identityId: string;
  progress: ReadonlyMap<string, number>;
  now: number;
  canRetry(id: string): boolean;
  retry(id: string): void;
  remove(id: string): void;
}

const NO_PROGRESS: ReadonlyMap<string, number> = new Map();

export const ImageBoardContext = createContext<ImageBoardState>({
  identityId: '',
  progress: NO_PROGRESS,
  now: 0,
  canRetry: () => false,
  retry: () => undefined,
  remove: () => undefined,
});

/**
 * The board's clock for images: Date.now(), refreshed every IMAGE_CLOCK_TICK_MS while `active`
 * (some image is uploading), so abandoned uploads turn "unfinished" without any interaction.
 */
export function useImageClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), IMAGE_CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * An image on the board (registry component): positioned at its box, pressed to select and
 * move like any object (story 7), Tab-focusable, announced as "Image".
 */
function ImageBoardObjectImpl(props: ObjectProps) {
  const { object, zoom, stackIndex, selected, dragging, readOnly, onSelect } = props;
  const onGesturePointerDown = props.onPointerDown;
  const board = useContext(ImageBoardContext);
  const pointerFocusRef = useRef(false);
  if (!isImage(object)) return null;
  const image = object;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    pointerFocusRef.current = true;
    onGesturePointerDown(e, image.id);
  };

  const onFocus = (e: ReactFocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const fromPointer = pointerFocusRef.current;
    pointerFocusRef.current = false;
    if (!fromPointer && !selected) onSelect(image.id);
  };

  const style: CSSProperties = {
    transform: `translate(${image.x}px, ${image.y}px)`,
    width: image.width,
    height: image.height,
    zIndex: stackIndex,
    outlineWidth: selected ? `${OUTLINE_SCREEN_PX / zoom}px` : undefined,
  };
  const className = ['image-object', selected && 'image-object--selected', dragging && 'image-object--dragging']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      role="group"
      aria-roledescription="image"
      aria-label={IMAGE_LABEL}
      tabIndex={0}
      data-testid="image-object"
      data-id={image.id}
      data-status={displayStatus(image, board.now)}
      data-selected={selected ? 'true' : 'false'}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => e.stopPropagation()}
      onFocus={onFocus}
    >
      <ImageObject
        image={image}
        isUploader={image.uploaderId === board.identityId}
        progress={board.progress.get(image.id)}
        canRetry={board.canRetry(image.id)}
        now={board.now}
        onRetry={() => board.retry(image.id)}
        onRemove={() => board.remove(image.id)}
        readOnly={readOnly}
      />
    </div>
  );
}

export const ImageBoardObject = memo(ImageBoardObjectImpl);
