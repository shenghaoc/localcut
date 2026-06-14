/** Lazily import `@mediapipe/tasks-vision`. Returns `unknown`; callers narrow to
 *  the minimal local surface they use so the package's types stay out of the
 *  TypeScript program. */
export function loadMediapipeVision(): Promise<unknown>;
