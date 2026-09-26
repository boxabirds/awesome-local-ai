import { PROJECT_ID_BYTES, TASK_ID_BYTES } from '@todoodle/shared/limits';

/**
 * A new task id: TASK_ID_BYTES random bytes as lowercase hex (32 chars), the format the server
 * validates. Generated before the first request, so Retry resends the same id and never duplicates.
 */
export function newTaskId(): string {
  return randomHex(TASK_ID_BYTES);
}

/** A new project id (story 7): the same format as task ids, generated client-side so a create is idempotent. */
export function newProjectId(): string {
  return randomHex(PROJECT_ID_BYTES);
}

function randomHex(byteCount: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
