/**
 * Phase 47 (T2): minimal SDP munging for WHIP ICE restart (RFC 9725 §4.6).
 * The PATCH body is a `trickle-ice-sdpfrag`: the new ICE ufrag/pwd plus each
 * media section's mid and candidates. The PATCH answer is the same shape from
 * the server side and must be folded back into the stored remote description.
 *
 * Pure string transforms — no RTC objects — so they unit-test in Node.
 */

const LINE_BREAK = /\r\n|\n/;

function lines(sdp: string): string[] {
	return sdp.split(LINE_BREAK).filter((line) => line.length > 0);
}

function valueOf(line: string): string {
	return line.slice(line.indexOf(':') + 1);
}

interface FragmentSection {
	mLine: string;
	mid: string | null;
	candidates: string[];
}

interface ParsedFragment {
	ufrag: string | null;
	pwd: string | null;
	sections: FragmentSection[];
}

function parseSections(sdp: string): ParsedFragment {
	const parsed: ParsedFragment = { ufrag: null, pwd: null, sections: [] };
	let current: FragmentSection | null = null;
	for (const line of lines(sdp)) {
		if (line.startsWith('m=')) {
			current = { mLine: line, mid: null, candidates: [] };
			parsed.sections.push(current);
		} else if (line.startsWith('a=ice-ufrag:')) {
			parsed.ufrag ??= valueOf(line);
		} else if (line.startsWith('a=ice-pwd:')) {
			parsed.pwd ??= valueOf(line);
		} else if (current && line.startsWith('a=mid:')) {
			current.mid = valueOf(line);
		} else if (current && line.startsWith('a=candidate:')) {
			current.candidates.push(line);
		}
	}
	return parsed;
}

/**
 * Builds the PATCH body from the post-restart local description (after ICE
 * gathering completed, so the candidates are inline).
 */
export function buildIceRestartFragment(localSdp: string): string {
	const parsed = parseSections(localSdp);
	if (!parsed.ufrag || !parsed.pwd) {
		throw new Error('Local description has no ICE credentials to restart with.');
	}
	const fragment: string[] = [`a=ice-ufrag:${parsed.ufrag}`, `a=ice-pwd:${parsed.pwd}`];
	for (const section of parsed.sections) {
		fragment.push(section.mLine);
		if (section.mid !== null) fragment.push(`a=mid:${section.mid}`);
		fragment.push(...section.candidates, 'a=end-of-candidates');
	}
	return fragment.join('\r\n') + '\r\n';
}

/**
 * Folds the server's restart answer fragment into the stored remote SDP:
 * replaces every ICE ufrag/pwd, drops stale candidates, and inserts the
 * fragment's candidates into the media section with the matching mid.
 */
export function applyIceRestartAnswer(remoteSdp: string, answerFragment: string): string {
	const fragment = parseSections(answerFragment);
	if (!fragment.ufrag || !fragment.pwd) {
		throw new Error('Restart answer fragment has no ICE credentials.');
	}
	const candidatesByMid = new Map<string | null, string[]>();
	for (const section of fragment.sections) {
		candidatesByMid.set(section.mid, section.candidates);
	}

	const output: string[] = [];
	let currentMid: string | null = null;
	let sectionIndex = -1;

	function flushCandidates() {
		if (sectionIndex === -1) return;
		const fresh =
			candidatesByMid.get(currentMid) ?? fragment.sections[sectionIndex]?.candidates ?? [];
		output.push(...fresh);
	}

	for (const line of lines(remoteSdp)) {
		if (line.startsWith('m=')) {
			flushCandidates();
			sectionIndex += 1;
			currentMid = null;
			output.push(line);
		} else if (line.startsWith('a=ice-ufrag:')) {
			output.push(`a=ice-ufrag:${fragment.ufrag}`);
		} else if (line.startsWith('a=ice-pwd:')) {
			output.push(`a=ice-pwd:${fragment.pwd}`);
		} else if (line.startsWith('a=candidate:') || line === 'a=end-of-candidates') {
			// Stale pre-restart candidates are dropped; fresh ones flush per section.
		} else {
			if (line.startsWith('a=mid:')) currentMid = valueOf(line);
			output.push(line);
		}
	}
	flushCandidates();
	return output.join('\r\n') + '\r\n';
}
