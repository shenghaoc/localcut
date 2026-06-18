type ClassValue = string | number | false | null | undefined;

/** Join local class names and conditional fragments without pulling UI-only helpers. */
export function cn(...inputs: ClassValue[]): string {
	return inputs
		.filter((input) => input !== false && input !== null && input !== undefined)
		.join(' ');
}
