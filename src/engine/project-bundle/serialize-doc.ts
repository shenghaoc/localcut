import type { ProjectDoc } from '../project';

/** JSON replacer: `Float32Array` LUT tables must become plain arrays for bundle import. */
function bundleProjectJsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Float32Array) {
    return Array.from(value);
  }
  return value;
}

/** Serialize `ProjectDoc` for `project.json` inside a portable bundle. */
export function serializeProjectDocForBundle(doc: ProjectDoc): string {
  return JSON.stringify(doc, bundleProjectJsonReplacer, 2);
}
