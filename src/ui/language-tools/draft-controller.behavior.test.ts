/**
 * Phase 40 (T11.2): DraftController.generateDraft behaviour with the Chrome AI
 * globals stubbed — empty guard, Prompt parsing, quota bounding (P1-D), and the
 * summarizer-only path.
 */
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { DraftController } from './draft-controller';
import type { CaptionSegmentSnapshot, LanguageToolsProbeResult } from '../../protocol';

function segs(texts: string[]): CaptionSegmentSnapshot[] {
	return texts.map((t, i) => ({ id: `s${i}`, start: i, duration: 1, text: t }));
}

function streamOf(chunks: string[]): ReadableStream<string> {
	return new ReadableStream({
		start(controller) {
			for (const c of chunks) controller.enqueue(c);
			controller.close();
		}
	});
}

const LM_ONLY: LanguageToolsProbeResult = {
	translator: {},
	languageDetector: 'unavailable',
	summarizer: 'unavailable',
	languageModel: 'available'
};

const SUMMARIZER_ONLY: LanguageToolsProbeResult = {
	translator: {},
	languageDetector: 'unavailable',
	summarizer: 'available',
	languageModel: 'unavailable'
};

afterEach(() => vi.unstubAllGlobals());

describe('DraftController.generateDraft', () => {
	it('errors on an empty transcript', async () => {
		vi.stubGlobal('LanguageModel', {
			availability: async () => 'available',
			create: async () => ({
				promptStreaming: () => streamOf([]),
				measureInputUsage: async () => 1,
				inputQuota: 1000,
				destroy: () => {}
			})
		});
		const controller = new DraftController();
		controller.setProbe(LM_ONLY);
		await controller.generateDraft(segs(['   ', '']));
		expect(controller.getState().job?.phase).toBe('error');
	});

	it('drafts via the Prompt API and parses the delimited response', async () => {
		vi.stubGlobal('LanguageModel', {
			availability: async () => 'available',
			create: async () => ({
				promptStreaming: () => streamOf(['TITLES:\nA\nB\nC\nHASHTAGS:\n#x #y\nCAPTION:\n文案']),
				measureInputUsage: async () => 1,
				inputQuota: 100000,
				destroy: () => {}
			})
		});
		const controller = new DraftController();
		controller.setProbe(LM_ONLY);
		await controller.generateDraft(segs(['hello world']));

		const job = controller.getState().job!;
		expect(job.phase).toBe('done');
		expect(job.draft?.titles).toEqual(['A', 'B', 'C']);
		expect(job.draft?.hashtags).toEqual(['#x', '#y']);
		expect(job.draft?.caption).toBe('文案');
	});

	it('bounds the prompt input to inputQuota when no summarizer is available (P1-D)', async () => {
		const prompts: string[] = [];
		vi.stubGlobal('LanguageModel', {
			availability: async () => 'available',
			create: async () => ({
				promptStreaming: (p: string) => {
					prompts.push(p);
					return streamOf(['TITLES:\nT\nHASHTAGS:\n#a\nCAPTION:\nc']);
				},
				// Report usage proportional to length; a small quota forces truncation.
				measureInputUsage: async (t: string) => t.length,
				inputQuota: 600,
				destroy: () => {}
			})
		});
		const controller = new DraftController();
		controller.setProbe(LM_ONLY);
		const longText = 'word '.repeat(1000); // ~5000 chars
		await controller.generateDraft(segs([longText]));

		expect(controller.getState().job?.phase).toBe('done');
		expect(prompts).toHaveLength(1);
		expect(prompts[0]!.length).toBeLessThan(longText.length);
	});

	it('returns the summary as the caption when only the summarizer is available', async () => {
		vi.stubGlobal('Summarizer', {
			availability: async () => 'available',
			create: async () => ({
				summarize: async () => 'a concise summary',
				measureInputUsage: async () => 1,
				inputQuota: 100000,
				destroy: () => {}
			})
		});
		const controller = new DraftController();
		controller.setProbe(SUMMARIZER_ONLY);
		await controller.generateDraft(segs(['blah blah']));

		const job = controller.getState().job!;
		expect(job.phase).toBe('done');
		expect(job.draft?.caption).toBe('a concise summary');
		expect(job.draft?.titles).toEqual([]);
	});
});
