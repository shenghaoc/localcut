export function waitForEvent(
  target: EventTarget,
  type: string,
  timeoutMs = 5000,
): Promise<Event> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for ${type} after ${timeoutMs}ms.`));
    }, timeoutMs);
    const onSuccess = (event: Event) => {
      cleanup();
      resolve(event);
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed while waiting for ${type}.`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(type, onSuccess);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(type, onSuccess, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}
