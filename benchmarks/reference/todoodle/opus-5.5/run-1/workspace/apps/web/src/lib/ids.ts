import { TASK_ID_BYTES } from '@todoodle/shared/limits';

/**
 * A new task id: TASK_ID_BYTES random bytes as lowercase hex (32 chars), the format the server
 * validates. Generated before the first request, so Retry resends the same id and never duplicates.
 */
export function newTaskId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TASK_ID_BYTES));
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
