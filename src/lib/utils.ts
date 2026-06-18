type ClassValue = string | number | boolean | null | undefined;

/** Join local class names and conditional fragments without pulling UI-only helpers. */
export function cn(...inputs: ClassValue[]): string {
	return inputs.filter(Boolean).join(' ');
}
