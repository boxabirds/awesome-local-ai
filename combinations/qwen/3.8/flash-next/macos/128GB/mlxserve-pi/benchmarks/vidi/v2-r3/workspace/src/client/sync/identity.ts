/*! Which of the people on this board this tab is (story 12).
 *
 * An image placeholder carries the id of whoever asked for it to be uploaded, which
 * is the only way a board two rooms away can tell that the picture it is showing as
 * "Uploading…" is not one that *it* is still sending — and say so honestly as "Image
 * upload didn't finish" instead of waiting for an upload that belongs to a browser
 * somewhere else.
 *
 * It is a random id made once per page, and it is kept to that on purpose. It is not
 * an account, it is not remembered, and it is not written anywhere the board keeps
 * anything: the board's document holds the id of whoever asked for an upload, in the
 * same way it holds the fact that somebody started one, and it says nothing about who
 * they are. A reload makes a new one, which is why a reload also turns your own
 * unfinished upload into somebody else's.
 */

/** Ids are random rather than numbered: two tabs on one machine are two people as
 *  far as a board is concerned, and a counter would be a way for them to collide. */
function random(): string {
  const cryptoObject = typeof crypto === 'undefined' ? undefined : crypto;
  if (cryptoObject !== undefined && typeof cryptoObject.randomUUID === 'function') {
    return cryptoObject.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoObject !== undefined && typeof cryptoObject.getRandomValues === 'function') {
    cryptoObject.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** This visit. One per page load, and one per component test render of a board. */
export const VISITOR_ID: string = random();
