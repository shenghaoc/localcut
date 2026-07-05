/**
 * Shared blob download utility.
 *
 * Creates a temporary Object URL, triggers a download via a synthetic
 * anchor click, then revokes the URL. Replaces the 5+ inline copies of
 * the create-anchor-click-revoke pattern.
 */

export function downloadBlob(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	try {
		document.body.appendChild(a);
		a.click();
	} finally {
		// Schedule revocation even if the synthetic click or cleanup throws.
		// A 10-second timeout is safer for large files (like video exports) to
		// prevent premature revocation in Safari's async download manager.
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
		a.remove();
	}
}
