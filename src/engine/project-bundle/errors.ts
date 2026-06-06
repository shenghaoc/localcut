export class BundleJobCanceledError extends Error {
  constructor() {
    super('Bundle job canceled.');
    this.name = 'BundleJobCanceledError';
  }
}

export function throwIfBundleJobCanceled(isCancelled?: () => boolean): void {
  if (isCancelled?.()) {
    throw new BundleJobCanceledError();
  }
}
