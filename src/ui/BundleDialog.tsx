import { createSignal, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Popover } from '@ark-ui/solid/popover';
import { FolderArchive, FolderInput, FolderOutput } from 'lucide-solid';
import { Button, buttonVariants } from './components/button';
import type {
	BundleIntegrityItemSnapshot,
	BundleIntegrityReportSnapshot,
	BundleSourcePolicySnapshot
} from '../protocol';

interface BundleDialogProps {
	disabled?: boolean;
	directoryPickerAvailable: boolean;
	onExport: (policy: BundleSourcePolicySnapshot, outputDir: FileSystemDirectoryHandle) => void;
	onImport: (bundleDir: FileSystemDirectoryHandle) => void;
	onCollect: (relocate: boolean, outputDir: FileSystemDirectoryHandle) => void;
	onCancelJob: () => void;
	busy: boolean;
	progressPhase: string | null;
	integrityReport: BundleIntegrityReportSnapshot | null;
	lastMessage: string | null;
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

async function pickDirectory(
	mode: 'read' | 'readwrite'
): Promise<FileSystemDirectoryHandle | null> {
	const picker = (
		window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }
	).showDirectoryPicker;
	if (!picker) return null;
	try {
		const handle = await picker();
		if (mode === 'readwrite' && handle.requestPermission) {
			const status = await handle.requestPermission({ mode: 'readwrite' });
			if (status !== 'granted') return null;
		}
		return handle;
	} catch (error) {
		if (isAbortError(error)) return null;
		throw error;
	}
}

export function BundleDialog(props: BundleDialogProps) {
	const [open, setOpen] = createSignal(false);
	const [relocate, setRelocate] = createSignal(false);

	const runExport = async (policy: BundleSourcePolicySnapshot) => {
		const dir = await pickDirectory('readwrite');
		if (!dir) return;
		props.onExport(policy, dir);
		setOpen(true);
	};

	const runImport = async () => {
		const dir = await pickDirectory('read');
		if (!dir) return;
		props.onImport(dir);
		setOpen(true);
	};

	const runCollect = async () => {
		const dir = await pickDirectory('readwrite');
		if (!dir) return;
		props.onCollect(relocate(), dir);
		setOpen(true);
	};

	return (
		<Popover.Root
			open={open()}
			onOpenChange={(details) => setOpen(details.open)}
			positioning={{ placement: 'bottom-end', gutter: 8 }}
		>
			<Popover.Trigger
				class={buttonVariants({ variant: 'outline' })}
				disabled={props.disabled || !props.directoryPickerAvailable}
				title={
					props.directoryPickerAvailable
						? 'Export, import, or collect project media'
						: 'Project bundles require a Chromium directory picker'
				}
			>
				<FolderArchive size={14} aria-hidden="true" />
				Project
			</Popover.Trigger>
			<Portal>
				<Popover.Positioner>
					<Popover.Content class="export-popover bundle-popover" aria-label="Project bundle">
						<div class="export-popover-header">
							<h2 class="export-popover-title">
								Project bundle{' '}
								<span class="text-xs text-muted-foreground font-normal">(Experimental)</span>
							</h2>
							<p class="export-popover-subtitle">
								Move projects between browsers with a portable folder bundle.
							</p>
						</div>
						<div class="bundle-actions">
							<Button
								variant="default"
								disabled={props.busy}
								onClick={() => void runExport({ mode: 'embed-media' })}
							>
								<FolderOutput size={14} aria-hidden="true" />
								Export project…
							</Button>
							<Button
								variant="outline"
								disabled={props.busy}
								onClick={() => void runExport({ mode: 'reference-only' })}
							>
								Export references only
							</Button>
							<Button variant="outline" disabled={props.busy} onClick={() => void runImport()}>
								<FolderInput size={14} aria-hidden="true" />
								Import project…
							</Button>
							<label class="bundle-collect-row">
								<input
									type="checkbox"
									checked={relocate()}
									onChange={(event) => setRelocate(event.currentTarget.checked)}
									disabled={props.busy}
								/>
								Relocate in-editor paths after collect
							</label>
							<Button variant="outline" disabled={props.busy} onClick={() => void runCollect()}>
								<FolderArchive size={14} aria-hidden="true" />
								Collect media…
							</Button>
						</div>
						<Show
							when={props.busy || props.progressPhase || props.integrityReport || props.lastMessage}
						>
							<div class="bundle-status" aria-live="polite">
								<Show when={props.busy && props.progressPhase}>
									<p>Working… {props.progressPhase}</p>
								</Show>
								<Show when={props.lastMessage}>
									<p>{props.lastMessage}</p>
								</Show>
								<Show when={props.integrityReport}>
									{(report) => (
										<div class="bundle-integrity">
											<p class={report().ok ? 'is-ok' : 'is-warn'}>
												{report().ok ? 'Bundle integrity OK' : 'Bundle integrity issues'}
											</p>
											<ul>
												<For
													each={report()
														.items.filter((item: BundleIntegrityItemSnapshot) => item.code !== 'ok')
														.slice(0, 8)}
												>
													{(item) => <li>{item.message}</li>}
												</For>
											</ul>
										</div>
									)}
								</Show>
								<Show when={props.busy}>
									<Button variant="ghost" onClick={() => props.onCancelJob()}>
										Cancel
									</Button>
								</Show>
							</div>
						</Show>
					</Popover.Content>
				</Popover.Positioner>
			</Portal>
		</Popover.Root>
	);
}
