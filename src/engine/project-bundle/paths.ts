import type { MediaFingerprint } from './types';

export function sanitizeBundleFileName(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, '_').replace(/\.\./g, '_');
  return base.slice(0, 180) || 'asset';
}

export function mediaRelativePath(fingerprint: MediaFingerprint, fileName: string): string {
  const prefix = fingerprint.digest.slice(0, 16);
  const dot = fileName.lastIndexOf('.');
  const ext = dot >= 0 ? fileName.slice(dot) : '';
  const stem = dot >= 0 ? fileName.slice(0, dot) : fileName;
  return `media/${prefix}_${sanitizeBundleFileName(stem)}${ext}`;
}

export function lutRelativePath(fingerprint: MediaFingerprint, fileName: string): string {
  const prefix = fingerprint.digest.slice(0, 16);
  const stem = fileName.endsWith('.cube') ? fileName.slice(0, -5) : fileName;
  return `assets/luts/${prefix}_${sanitizeBundleFileName(stem)}.cube`;
}

export const MANIFEST_PATH = 'manifest.json';
export const PROJECT_PATH = 'project.json';
