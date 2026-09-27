import { TASK_ID_BYTES } from '@todoodle/shared/limits';

/** A new task id: TASK_ID_BYTES random bytes as lowercase hex (the server's id format). */
export function newTaskId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(TASK_ID_BYTES)), (b) => b.toString(16).padStart(2, '0')).join('');
}
