interface KeyboardShortcutHandlers {
	onUndo: () => void;
	onRedo: () => void;
	onSplit: () => void;
	onDelete: () => void;
	onPlay: () => void;
	onPause: () => void;
	onStep: (direction: 1 | -1) => void;
	onZoom: (direction: 1 | -1) => void;
	onCopy: () => void;
	onPaste: () => void;
	onDuplicate: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName.toLowerCase();
	return tag === 'input' || tag === 'textarea' || tag === 'select';
}

export function registerKeyboardShortcuts(handlers: KeyboardShortcutHandlers): () => void {
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.defaultPrevented || isEditableTarget(event.target)) return;
		const key = event.key.toLowerCase();
		const mod = event.metaKey || event.ctrlKey;

		if (mod && !event.altKey) {
			switch (key) {
				case 'z':
					event.preventDefault();
					if (event.shiftKey) handlers.onRedo();
					else handlers.onUndo();
					return;
				case 'y':
					event.preventDefault();
					handlers.onRedo();
					return;
				case 'c':
					event.preventDefault();
					handlers.onCopy();
					return;
				case 'v':
					event.preventDefault();
					handlers.onPaste();
					return;
				case 'd':
					event.preventDefault();
					handlers.onDuplicate();
					return;
				case '=':
				case '+':
					event.preventDefault();
					handlers.onZoom(1);
					return;
				case '-':
					event.preventDefault();
					handlers.onZoom(-1);
					return;
			}
		}

		if (event.metaKey || event.ctrlKey || event.altKey) return;
		switch (key) {
			case 's':
				event.preventDefault();
				handlers.onSplit();
				break;
			case 'delete':
			case 'backspace':
				event.preventDefault();
				handlers.onDelete();
				break;
			case 'j':
				event.preventDefault();
				handlers.onStep(-1);
				break;
			case 'k':
				event.preventDefault();
				handlers.onPause();
				break;
			case 'l':
				event.preventDefault();
				handlers.onPlay();
				break;
		}
	};

	window.addEventListener('keydown', onKeyDown);
	return () => window.removeEventListener('keydown', onKeyDown);
}
