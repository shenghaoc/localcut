/** Phase 43: Padded Background Inspector panel.
 *
 *  Toggle on/off, choose background kind, adjust all parameters with live
 *  preview via the existing 80 ms debounce + worker message pattern.
 */

import { createSignal, createEffect, Show, For, onCleanup } from 'solid-js';
import type {
	MediaAssetSnapshot,
	PaddedBackgroundParams,
	PaddedBackgroundKind,
	GradientStop
} from '../protocol';
import { DEFAULT_PADDED_BACKGROUND } from '../engine/padded-background';

interface PaddedBackgroundPanelProps {
	trackId: string;
	clipId: string;
	paddedBackground?: PaddedBackgroundParams;
	mediaAssets?: readonly MediaAssetSnapshot[];
	onSetPaddedBackground: (
		trackId: string,
		clipId: string,
		params: PaddedBackgroundParams | null
	) => void;
}

const PARAM_DEBOUNCE_MS = 80;

export function PaddedBackgroundPanel(props: PaddedBackgroundPanelProps) {
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	const enabled = () => props.paddedBackground != null;

	const [params, setParams] = createSignal<PaddedBackgroundParams>(
		// oxlint-disable-next-line solid/reactivity -- intentional initial seed; createEffect below syncs external changes
		props.paddedBackground ?? { ...DEFAULT_PADDED_BACKGROUND }
	);

	// Sync when external params change
	createEffect(() => {
		if (props.paddedBackground) {
			setParams({ ...props.paddedBackground });
		}
	});

	const dispatch = (next: PaddedBackgroundParams) => {
		setParams(next);
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			props.onSetPaddedBackground(props.trackId, props.clipId, next);
		}, PARAM_DEBOUNCE_MS);
	};

	const toggle = () => {
		if (enabled()) {
			props.onSetPaddedBackground(props.trackId, props.clipId, null);
		} else {
			const p = params();
			props.onSetPaddedBackground(props.trackId, props.clipId, p);
		}
	};

	const updateParam = <K extends keyof PaddedBackgroundParams>(
		key: K,
		value: PaddedBackgroundParams[K]
	) => {
		dispatch({ ...params(), [key]: value });
	};

	onCleanup(() => {
		if (debounceTimer) clearTimeout(debounceTimer);
	});

	const bgKind = () => params().background.kind;
	const wallpaperAssets = () =>
		(props.mediaAssets ?? []).filter((asset) => asset.kind === 'video' || asset.kind === 'image');

	return (
		<section class="inspector-section">
			<h3>Padded Background</h3>

			<label class="toggle-label">
				<input type="checkbox" checked={enabled()} onChange={toggle} />
				Enable
			</label>

			<Show when={enabled()}>
				<div class="padded-bg-controls">
					<div class="bg-kind-picker">
						<For each={['solid', 'gradient', 'wallpaper'] as PaddedBackgroundKind[]}>
							{(kind) => (
								<label>
									<input
										type="radio"
										name="bg-kind"
										value={kind}
										checked={bgKind() === kind}
										onChange={() => {
											const bg =
												kind === 'solid'
													? { kind: 'solid' as const, color: '#1a1a2e' }
													: kind === 'gradient'
														? {
																kind: 'gradient' as const,
																stops: [
																	{ color: '#1a1a2e', pos: 0 },
																	{ color: '#16213e', pos: 1 }
																],
																angleDeg: 0
															}
														: { kind: 'wallpaper' as const, sourceId: '' };
											updateParam('background', bg);
										}}
									/>
									{kind.charAt(0).toUpperCase() + kind.slice(1)}
								</label>
							)}
						</For>
					</div>

					<Show when={bgKind() === 'solid'}>
						<label>
							Colour
							<input
								type="color"
								value={(params().background as { kind: 'solid'; color: string }).color}
								onInput={(e) =>
									updateParam('background', {
										kind: 'solid',
										color: e.currentTarget.value
									})
								}
							/>
						</label>
					</Show>

					<Show when={bgKind() === 'gradient'}>
						<For each={(params().background as { kind: 'gradient'; stops: GradientStop[] }).stops}>
							{(stop, i) => (
								<div class="gradient-stop">
									<input
										type="color"
										value={stop.color}
										onInput={(e) => {
											const bg = params().background as {
												kind: 'gradient';
												stops: GradientStop[];
												angleDeg: number;
											};
											const stops = [...bg.stops];
											stops[i()] = { ...stops[i()]!, color: e.currentTarget.value };
											updateParam('background', { ...bg, stops });
										}}
									/>
									<input
										type="range"
										min={0}
										max={1}
										step={0.01}
										value={stop.pos}
										onInput={(e) => {
											const bg = params().background as {
												kind: 'gradient';
												stops: GradientStop[];
												angleDeg: number;
											};
											const stops = [...bg.stops];
											stops[i()] = { ...stops[i()]!, pos: Number(e.currentTarget.value) };
											updateParam('background', { ...bg, stops });
										}}
									/>
								</div>
							)}
						</For>
						<label>
							Angle
							<input
								type="range"
								min={0}
								max={360}
								step={1}
								value={(params().background as { kind: 'gradient'; angleDeg: number }).angleDeg}
								onInput={(e) => {
									const bg = params().background as {
										kind: 'gradient';
										stops: GradientStop[];
										angleDeg: number;
									};
									updateParam('background', { ...bg, angleDeg: Number(e.currentTarget.value) });
								}}
							/>
						</label>
					</Show>

					<Show when={bgKind() === 'wallpaper'}>
						<label>
							Wallpaper source
							<select
								value={(params().background as { kind: 'wallpaper'; sourceId: string }).sourceId}
								onChange={(e) =>
									updateParam('background', {
										kind: 'wallpaper',
										sourceId: e.currentTarget.value
									})
								}
							>
								<option value="">Select media...</option>
								<For each={wallpaperAssets()}>
									{(asset) => <option value={asset.sourceId}>{asset.fileName}</option>}
								</For>
							</select>
						</label>
					</Show>

					<label>
						Inset margin
						<input
							type="range"
							min={0}
							max={0.4}
							step={0.01}
							value={params().insetMargin}
							onInput={(e) => updateParam('insetMargin', Number(e.currentTarget.value))}
						/>
						<span>{(params().insetMargin * 100).toFixed(0)}%</span>
					</label>

					<label>
						Corner radius
						<input
							type="range"
							min={0}
							max={64}
							step={1}
							value={params().cornerRadius}
							onInput={(e) => updateParam('cornerRadius', Number(e.currentTarget.value))}
						/>
						<span>{params().cornerRadius} px</span>
					</label>

					<label>
						Shadow opacity
						<input
							type="range"
							min={0}
							max={1}
							step={0.01}
							value={params().shadowOpacity}
							onInput={(e) => updateParam('shadowOpacity', Number(e.currentTarget.value))}
						/>
						<span>{params().shadowOpacity.toFixed(2)}</span>
					</label>

					<label>
						Shadow radius
						<input
							type="range"
							min={0}
							max={64}
							step={1}
							value={params().shadowRadius}
							onInput={(e) => updateParam('shadowRadius', Number(e.currentTarget.value))}
						/>
						<span>{params().shadowRadius} px</span>
					</label>

					<label>
						Shadow offset Y
						<input
							type="range"
							min={-32}
							max={32}
							step={1}
							value={params().shadowOffsetY}
							onInput={(e) => updateParam('shadowOffsetY', Number(e.currentTarget.value))}
						/>
						<span>{params().shadowOffsetY} px</span>
					</label>
				</div>
			</Show>
		</section>
	);
}
