import type { Task } from '@todoodle/shared/schemas';

/** A new task not yet confirmed by the server: saving, failed (retryable) or rejected (discard only). */
export type LocalStatus = 'pending' | 'failed' | 'rejected';

/** A cached task; `localStatus` is set only on rows the server hasn't confirmed. */
export type LocalTask = Task & { localStatus?: LocalStatus };
