/**
 * Creates a pointer event with the specified properties for use in jsdom.
 * jsdom doesn't support clientX/clientY on pointer events via fireEvent,
 * so we create the event manually and define the properties.
 */
export function createPointerEvent(
  type: string,
  props: {
    clientX?: number;
    clientY?: number;
    pointerId?: number;
    button?: number;
    shiftKey?: boolean;
  }
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: props.clientX ?? 0 },
    clientY: { value: props.clientY ?? 0 },
    pointerId: { value: props.pointerId ?? 1 },
    button: { value: props.button ?? 0 },
    shiftKey: { value: props.shiftKey ?? false },
  });
  return event;
}
