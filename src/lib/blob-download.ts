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
	document.body.appendChild(a);
	try {
		a.click();
	} finally {
		document.body.removeChild(a);
	}
	// Revoke after a short delay to ensure the browser has started the download.
	setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
