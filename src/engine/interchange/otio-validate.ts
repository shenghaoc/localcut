import { OTIO_SCHEMA_ALLOWLIST } from './otio';

/**
 * Structural validator for generated OTIO documents (R11.4). Not a general
 * OTIO validator: it asserts the invariants the Phase 48 serialiser
 * guarantees — allowlisted schema tags, required fields per schema, and
 * finite, non-negative times — so golden fixtures and unit tests catch
 * malformed output without the reference implementation.
 */

export interface OtioValidationIssue {
	path: string;
	message: string;
}

const ALLOWED = new Set<string>(OTIO_SCHEMA_ALLOWLIST);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(issues: OtioValidationIssue[], path: string, message: string): void {
	issues.push({ path, message });
}

function checkRationalTime(value: unknown, path: string, issues: OtioValidationIssue[]): void {
	if (!isRecord(value) || value.OTIO_SCHEMA !== 'RationalTime.1') {
		issue(issues, path, 'expected a RationalTime.1');
		return;
	}
	const rate = value.rate;
	const v = value.value;
	if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
		issue(issues, path, `rate must be a finite positive number, got ${String(rate)}`);
	}
	if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
		issue(issues, path, `value must be a finite non-negative number, got ${String(v)}`);
	}
}

function checkTimeRange(value: unknown, path: string, issues: OtioValidationIssue[]): void {
	if (!isRecord(value) || value.OTIO_SCHEMA !== 'TimeRange.1') {
		issue(issues, path, 'expected a TimeRange.1');
		return;
	}
	checkRationalTime(value.start_time, `${path}.start_time`, issues);
	checkRationalTime(value.duration, `${path}.duration`, issues);
}

function checkString(
	node: Record<string, unknown>,
	field: string,
	path: string,
	issues: OtioValidationIssue[]
): void {
	if (typeof node[field] !== 'string') {
		issue(issues, `${path}.${field}`, 'expected a string');
	}
}

const REQUIRED_FIELDS: Record<string, readonly string[]> = {
	'Timeline.1': ['name', 'metadata', 'global_start_time', 'tracks'],
	'Stack.1': ['name', 'metadata', 'children', 'markers'],
	'Track.1': ['name', 'metadata', 'children', 'markers', 'kind'],
	'Clip.2': ['name', 'metadata', 'source_range', 'media_references', 'active_media_reference_key'],
	'Gap.1': ['name', 'metadata', 'source_range'],
	'Transition.1': ['name', 'metadata', 'transition_type', 'in_offset', 'out_offset'],
	'Marker.2': ['name', 'metadata', 'color', 'marked_range'],
	'ExternalReference.1': ['name', 'metadata', 'target_url'],
	'GeneratorReference.1': ['name', 'metadata', 'generator_kind'],
	'MissingReference.1': ['name', 'metadata'],
	'RationalTime.1': ['rate', 'value'],
	'TimeRange.1': ['start_time', 'duration']
};

function checkNode(
	node: Record<string, unknown>,
	path: string,
	issues: OtioValidationIssue[]
): void {
	const schema = node.OTIO_SCHEMA;
	if (typeof schema !== 'string') {
		issue(issues, path, 'object with OTIO_SCHEMA missing a string tag');
		return;
	}
	if (!ALLOWED.has(schema)) {
		issue(issues, path, `schema ${schema} is not in the Phase 48 allowlist`);
		return;
	}
	for (const field of REQUIRED_FIELDS[schema] ?? []) {
		if (!(field in node)) {
			issue(issues, path, `${schema} is missing required field "${field}"`);
		}
	}
	switch (schema) {
		case 'RationalTime.1':
			checkRationalTime(node, path, issues);
			break;
		case 'TimeRange.1':
			checkTimeRange(node, path, issues);
			break;
		case 'Track.1':
			if (node.kind !== 'Video' && node.kind !== 'Audio') {
				issue(issues, `${path}.kind`, `expected "Video" or "Audio", got ${String(node.kind)}`);
			}
			break;
		case 'Clip.2': {
			checkString(node, 'active_media_reference_key', path, issues);
			const refs = node.media_references;
			const key = node.active_media_reference_key;
			if (!isRecord(refs) || typeof key !== 'string' || !(key in refs)) {
				issue(issues, `${path}.media_references`, 'active media reference key not present');
			}
			break;
		}
		case 'Transition.1':
			checkString(node, 'transition_type', path, issues);
			break;
		case 'Marker.2':
			checkString(node, 'color', path, issues);
			break;
		case 'ExternalReference.1':
			checkString(node, 'target_url', path, issues);
			break;
		case 'GeneratorReference.1':
			checkString(node, 'generator_kind', path, issues);
			break;
	}
}

function walk(value: unknown, path: string, issues: OtioValidationIssue[]): void {
	if (Array.isArray(value)) {
		value.forEach((item, index) => walk(item, `${path}[${index}]`, issues));
		return;
	}
	if (!isRecord(value)) return;
	if ('OTIO_SCHEMA' in value) checkNode(value, path, issues);
	for (const [key, child] of Object.entries(value)) {
		// metadata payloads are opaque foreign data — only schema-tagged
		// objects inside them would be validated, which is exactly right.
		walk(child, `${path}.${key}`, issues);
	}
}

/** Validate a parsed OTIO JSON document; returns an empty array when valid. */
export function validateOtioDocument(value: unknown): OtioValidationIssue[] {
	const issues: OtioValidationIssue[] = [];
	if (!isRecord(value) || value.OTIO_SCHEMA !== 'Timeline.1') {
		issue(issues, '$', 'root must be a Timeline.1');
		return issues;
	}
	if (!isRecord(value.tracks) || value.tracks.OTIO_SCHEMA !== 'Stack.1') {
		issue(issues, '$.tracks', 'Timeline.tracks must be a Stack.1');
	}
	walk(value, '$', issues);
	return issues;
}
