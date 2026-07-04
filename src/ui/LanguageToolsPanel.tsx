/**
 * "Language Tools" panel — Phase 40 (Chrome built-in AI).
 *
 * Thin renderer over `TranslationController` and `DraftController` state.
 * Two sections: Translate (caption track → second language track) and
 * Draft (transcript → titles/hashtags/文案). Both are progressive
 * enhancement — hidden when the APIs are absent.
 */
import { createEffect, createSignal, For, onCleanup, Show, type Component } from 'solid-js';
import { X, Copy, Check, Languages, FileText } from 'lucide-solid';
import { copyToClipboard } from '../lib/clipboard';
import { Button } from './components/button';
import type { TranslationControllerState } from './language-tools/translation-controller';
import type { DraftControllerState } from './language-tools/draft-controller';
import type { CaptionTrackSnapshot } from '../protocol';

export interface LanguageToolsPanelProps {
	open: boolean;
	mode?: 'dialog' | 'embedded';
	translationState: TranslationControllerState;
	draftState: DraftControllerState;
	captionTracks: readonly CaptionTrackSnapshot[];
	onTranslate: (trackId: string, targetLang?: 'zh' | 'en') => void;
	onCancelTranslate: () => void;
	onGenerateDraft: (trackId: string) => void;
	onCancelDraft: () => void;
	onExportBilingual: (sourceTrackId: string, translatedTrackId: string) => void;
	onOpenGuide?: () => void;
	onClose: () => void;
}

const PRIVACY_STATEMENT =
	"All translation and drafting run on this device through Chrome's built-in AI. Nothing is uploaded. No cloud API.";

function formatDuration(ms: number | null): string {
	if (ms === null) return '—';
	if (ms >= 60000) return `${(ms / 60000).toFixed(1)} min`;
	return `${(ms / 1000).toFixed(2)} s`;
}

function formatPercent(fraction: number | null): string {
	if (fraction === null) return '';
	return ` ${Math.round(fraction * 100)}%`;
}

function createCopiedFieldFeedback(setCopiedField: (field: string | null) => void) {
	let resetTimer: ReturnType<typeof setTimeout> | undefined;

	onCleanup(() => {
		if (resetTimer !== undefined) clearTimeout(resetTimer);
	});

	return (field: string) => {
		if (resetTimer !== undefined) clearTimeout(resetTimer);
		setCopiedField(field);
		resetTimer = setTimeout(() => {
			setCopiedField(null);
			resetTimer = undefined;
		}, 2000);
	};
}

function createFieldCopier(markCopiedField: (field: string) => void) {
	return async (text: string, field: string) => {
		const res = await copyToClipboard(text);
		if (res.ok) {
			markCopiedField(field);
		} else {
			console.debug('Clipboard write failed:', res.error);
		}
	};
}

export const LanguageToolsPanel: Component<LanguageToolsPanelProps> = (props) => {
	let panelRef: HTMLElement | undefined;
	const [selectedTrackId, setSelectedTrackId] = createSignal<string>('');
	const [targetLang, setTargetLang] = createSignal<'auto' | 'zh' | 'en'>('auto');
	const [copiedField, setCopiedField] = createSignal<string | null>(null);
	const markCopiedField = createCopiedFieldFeedback(setCopiedField);
	const copyField = createFieldCopier(markCopiedField);
	const embedded = () => props.mode === 'embedded';

	const detectorUsable = () => {
		const a = props.translationState.languageDetectorAvailability;
		return a === 'available' || a === 'downloadable' || a === 'downloading';
	};

	createEffect(() => {
		if (props.open) {
			if (!embedded()) requestAnimationFrame(() => panelRef?.focus());
			// Default to first track if none selected
			if (!selectedTrackId() && props.captionTracks.length > 0) {
				setSelectedTrackId(props.captionTracks[0].id);
			}
			// Default to auto-detect when the detector is usable; otherwise the
			// user must pick a target explicitly.
			setTargetLang(detectorUsable() ? 'auto' : 'en');
		}
	});

	const translateJob = () => props.translationState.job;
	const draftJob = () => props.draftState.job;
	const bilingualExportTrackId = () => {
		const translatedTrackId = props.translationState.lastTranslatedTrackId;
		if (!translatedTrackId) return null;
		return props.translationState.lastTranslatedSourceTrackId === selectedTrackId()
			? translatedTrackId
			: null;
	};

	const canTranslate = () => {
		const job = translateJob();
		if (
			job &&
			(job.phase === 'translating' || job.phase === 'detecting' || job.phase === 'downloading')
		)
			return false;
		return selectedTrackId() && props.translationState.available;
	};

	const canGenerateDraft = () => {
		const job = draftJob();
		if (
			job &&
			(job.phase === 'preparing' || job.phase === 'summarizing' || job.phase === 'generating')
		)
			return false;
		return selectedTrackId() && props.draftState.available;
	};

	return (
		<Show when={props.open}>
			<Show when={!embedded()}>
				<div class="capability-backdrop" onClick={() => props.onClose()} aria-hidden="true" />
			</Show>
			<aside
				ref={(element) => {
					panelRef = element;
				}}
				class={embedded() ? 'language-tools-rail-panel panel' : 'diagnostics-panel panel'}
				role={embedded() ? 'region' : 'dialog'}
				aria-modal={embedded() ? undefined : 'true'}
				aria-labelledby="language-tools-panel-title"
				tabIndex={-1}
				onKeyDown={(e) => {
					if (embedded()) return;
					if (e.key === 'Escape') props.onClose();
				}}
			>
				<header class="capability-panel-header">
					<div>
						<p class="panel-title" id="language-tools-panel-title">
							Language Tools
						</p>
						<p class="capability-panel-tier">{PRIVACY_STATEMENT}</p>
					</div>
					<Show when={!embedded()}>
						<Button
							size="icon"
							variant="ghost"
							onClick={props.onClose}
							aria-label="Close language tools panel"
						>
							<X size={16} aria-hidden="true" />
						</Button>
					</Show>
				</header>

				{/* Track picker — shared between sections */}
				<section class="diagnostics-section">
					<h2>Source Track</h2>
					<select
						value={selectedTrackId()}
						onChange={(e) => setSelectedTrackId(e.currentTarget.value)}
						aria-label="Select caption track"
					>
						<option value="" disabled>
							Select a caption track…
						</option>
						<For each={props.captionTracks}>
							{(track) => (
								<option value={track.id}>
									{track.name}
									{track.language ? ` (${track.language})` : ''}
								</option>
							)}
						</For>
					</select>
					<Show when={props.captionTracks.length === 0}>
						<p class="capability-panel-note">
							No caption tracks available. Import captions or generate auto captions first.
						</p>
					</Show>
				</section>

				{/* ── Translate Section ── */}
				<Show when={props.translationState.available}>
					<section class="diagnostics-section">
						<h2>
							<Languages size={14} aria-hidden="true" style={{ 'margin-right': '4px' }} />
							Translate
						</h2>

						{/* Target language picker */}
						<div
							style={{
								display: 'flex',
								gap: '8px',
								'align-items': 'center',
								'margin-bottom': '8px'
							}}
						>
							<label style={{ 'font-size': '0.85em' }}>Target:</label>
							<select
								value={targetLang()}
								onChange={(e) => setTargetLang(e.currentTarget.value as 'auto' | 'zh' | 'en')}
								aria-label="Target language"
							>
								<Show when={detectorUsable()}>
									<option value="auto">Auto-detect</option>
								</Show>
								<option value="en">English (en)</option>
								<option value="zh">Chinese (zh)</option>
							</select>
						</div>

						{/* Translate button */}
						<div style={{ display: 'flex', gap: '8px' }}>
							<Button
								size="sm"
								disabled={!canTranslate()}
								onClick={() => {
									const id = selectedTrackId();
									if (!id) return;
									const t = targetLang();
									props.onTranslate(id, t === 'auto' ? undefined : t);
								}}
							>
								Translate
							</Button>
							<Show
								when={
									translateJob()?.phase === 'translating' ||
									translateJob()?.phase === 'detecting' ||
									translateJob()?.phase === 'downloading'
								}
							>
								<Button size="sm" variant="ghost" onClick={props.onCancelTranslate}>
									Cancel
								</Button>
							</Show>
						</div>

						{/* Bilingual export — available once a translated track exists */}
						<Show when={bilingualExportTrackId()}>
							<Button
								size="sm"
								variant="ghost"
								style={{ 'margin-top': '8px' }}
								onClick={() => {
									const sourceTrackId = selectedTrackId();
									const translatedTrackId = bilingualExportTrackId();
									if (!sourceTrackId || !translatedTrackId) return;
									props.onExportBilingual(sourceTrackId, translatedTrackId);
								}}
							>
								Export bilingual (SRT + VTT)
							</Button>
						</Show>

						{/* Translation progress */}
						<Show when={translateJob()}>
							<div
								role="status"
								aria-live="polite"
								aria-atomic="true"
								style={{ 'margin-top': '8px' }}
							>
								<Show when={translateJob()!.phase === 'detecting'}>
									<p style={{ 'font-size': '0.85em' }}>
										Detecting language…{formatPercent(translateJob()!.downloadFraction)}
									</p>
								</Show>
								<Show when={translateJob()!.phase === 'downloading'}>
									<p style={{ 'font-size': '0.85em' }}>
										Downloading model…{formatPercent(translateJob()!.downloadFraction)}
									</p>
								</Show>
								<Show when={translateJob()!.phase === 'translating'}>
									<p style={{ 'font-size': '0.85em' }}>
										Translating {translateJob()!.current}/{translateJob()!.total} segments…
									</p>
									<progress
										value={translateJob()!.current}
										max={translateJob()!.total}
										style={{ width: '100%' }}
									/>
								</Show>
								<Show when={translateJob()!.phase === 'done'}>
									<p style={{ 'font-size': '0.85em', color: 'var(--color-success, #4ade80)' }}>
										✓ Translation complete ({formatDuration(translateJob()!.durationMs)})
									</p>
								</Show>
								<Show when={translateJob()!.phase === 'error'}>
									<p style={{ 'font-size': '0.85em', color: 'var(--color-error, #f87171)' }}>
										✗ {translateJob()!.error}
									</p>
								</Show>
							</div>
						</Show>
					</section>
				</Show>

				{/* ── Draft Section ── */}
				<Show when={props.draftState.available}>
					<section class="diagnostics-section">
						<h2>
							<FileText size={14} aria-hidden="true" style={{ 'margin-right': '4px' }} />
							Draft
						</h2>

						<div style={{ display: 'flex', gap: '8px' }}>
							<Button
								size="sm"
								disabled={!canGenerateDraft()}
								onClick={() => {
									const id = selectedTrackId();
									if (id) props.onGenerateDraft(id);
								}}
							>
								Generate Draft
							</Button>
							<Show
								when={
									draftJob()?.phase === 'preparing' ||
									draftJob()?.phase === 'summarizing' ||
									draftJob()?.phase === 'generating'
								}
							>
								<Button size="sm" variant="ghost" onClick={props.onCancelDraft}>
									Cancel
								</Button>
							</Show>
						</div>

						{/* Draft progress */}
						<Show when={draftJob()}>
							<div
								role="status"
								aria-live="polite"
								aria-atomic="true"
								style={{ 'margin-top': '8px' }}
							>
								<Show when={draftJob()!.phase === 'preparing'}>
									<p style={{ 'font-size': '0.85em' }}>
										Preparing model…{formatPercent(draftJob()!.downloadFraction)}
									</p>
								</Show>
								<Show when={draftJob()!.phase === 'summarizing'}>
									<p style={{ 'font-size': '0.85em' }}>Summarizing transcript…</p>
								</Show>
								<Show when={draftJob()!.phase === 'generating'}>
									<p style={{ 'font-size': '0.85em' }}>Generating drafts…</p>
									<Show when={draftJob()!.streamedText}>
										<pre
											style={{
												'font-size': '0.8em',
												'max-height': '120px',
												overflow: 'auto',
												'white-space': 'pre-wrap',
												'word-break': 'break-word',
												background: 'var(--color-surface, #1a1a2e)',
												padding: '8px',
												'border-radius': '4px',
												'margin-top': '4px'
											}}
										>
											{draftJob()!.streamedText}
										</pre>
									</Show>
								</Show>
								<Show when={draftJob()!.phase === 'error'}>
									<p style={{ 'font-size': '0.85em', color: 'var(--color-error, #f87171)' }}>
										✗ {draftJob()!.error}
									</p>
								</Show>
							</div>
						</Show>

						{/* Draft results */}
						<Show when={draftJob()?.phase === 'done' && draftJob()!.draft}>
							<div style={{ 'margin-top': '12px' }}>
								{/* Titles */}
								<Show when={draftJob()!.draft!.titles.length > 0}>
									<div style={{ 'margin-bottom': '12px' }}>
										<div
											style={{
												display: 'flex',
												'justify-content': 'space-between',
												'align-items': 'center'
											}}
										>
											<h3 style={{ 'font-size': '0.85em', 'font-weight': '600' }}>Titles</h3>
											<Button
												size="icon"
												variant="ghost"
												onClick={() => copyField(draftJob()!.draft!.titles.join('\n'), 'titles')}
												aria-label="Copy titles"
											>
												<Show when={copiedField() === 'titles'} fallback={<Copy size={14} />}>
													<Check size={14} />
												</Show>
											</Button>
										</div>
										<For each={draftJob()!.draft!.titles}>
											{(title, i) => (
												<p style={{ 'font-size': '0.85em', margin: '2px 0' }}>
													{i() + 1}. {title}
												</p>
											)}
										</For>
									</div>
								</Show>

								{/* Hashtags */}
								<Show when={draftJob()!.draft!.hashtags.length > 0}>
									<div style={{ 'margin-bottom': '12px' }}>
										<div
											style={{
												display: 'flex',
												'justify-content': 'space-between',
												'align-items': 'center'
											}}
										>
											<h3 style={{ 'font-size': '0.85em', 'font-weight': '600' }}>Hashtags</h3>
											<Button
												size="icon"
												variant="ghost"
												onClick={() => copyField(draftJob()!.draft!.hashtags.join(' '), 'hashtags')}
												aria-label="Copy hashtags"
											>
												<Show when={copiedField() === 'hashtags'} fallback={<Copy size={14} />}>
													<Check size={14} />
												</Show>
											</Button>
										</div>
										<p style={{ 'font-size': '0.85em' }}>{draftJob()!.draft!.hashtags.join(' ')}</p>
									</div>
								</Show>

								{/* Caption (文案) */}
								<Show when={draftJob()!.draft!.caption}>
									<div style={{ 'margin-bottom': '12px' }}>
										<div
											style={{
												display: 'flex',
												'justify-content': 'space-between',
												'align-items': 'center'
											}}
										>
											<h3 style={{ 'font-size': '0.85em', 'font-weight': '600' }}>
												文案 (Caption)
											</h3>
											<Button
												size="icon"
												variant="ghost"
												onClick={() => copyField(draftJob()!.draft!.caption, 'caption')}
												aria-label="Copy caption"
											>
												<Show when={copiedField() === 'caption'} fallback={<Copy size={14} />}>
													<Check size={14} />
												</Show>
											</Button>
										</div>
										<p style={{ 'font-size': '0.85em', 'white-space': 'pre-wrap' }}>
											{draftJob()!.draft!.caption}
										</p>
									</div>
								</Show>

								<p style={{ 'font-size': '0.75em', color: 'var(--color-muted, #888)' }}>
									Completed in {formatDuration(draftJob()!.durationMs)}
								</p>
							</div>
						</Show>
					</section>
				</Show>

				<Show when={props.onOpenGuide}>
					<footer class="capability-panel-note">
						<Button size="sm" variant="ghost" onClick={() => props.onOpenGuide?.()}>
							Learn more
						</Button>
					</footer>
				</Show>
			</aside>
		</Show>
	);
};
