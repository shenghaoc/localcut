/** Type declarations for the Web Speech API used by Phase 29 ASR. */

interface SpeechRecognition extends EventTarget {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	maxAlternatives: number;
	onaudioend: ((this: SpeechRecognition, ev: Event) => unknown) | null;
	onaudiostart: ((this: SpeechRecognition, ev: Event) => unknown) | null;
	onend: ((this: SpeechRecognition, ev: Event) => unknown) | null;
	onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => unknown) | null;
	onnomatch: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => unknown) | null;
	onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => unknown) | null;
	onsoundend: ((this: SpeechRecognition, ev: Event) => unknown) | null;
	onsoundstart: ((this: SpeechRecognition, ev: Event) => unknown) | null;
	onspeechend: ((this: SpeechRecognition, ev: Event) => unknown) | null;
	onspeechstart: ((this: SpeechRecognition, ev: Event) => unknown) | null;
	onstart: ((this: SpeechRecognition, ev: Event) => unknown) | null;
	start(): void;
	stop(): void;
	abort(): void;
}

declare var SpeechRecognition: {
	prototype: SpeechRecognition;
	new (): SpeechRecognition;
};

declare var webkitSpeechRecognition: {
	prototype: SpeechRecognition;
	new (): SpeechRecognition;
};

interface SpeechRecognitionErrorEvent extends Event {
	readonly error: SpeechRecognitionErrorCode;
	readonly message: string;
}

type SpeechRecognitionErrorCode =
	| 'no-speech'
	| 'aborted'
	| 'audio-capture'
	| 'network'
	| 'not-allowed'
	| 'service-not-allowed'
	| 'bad-grammar'
	| 'language-not-supported';

interface SpeechRecognitionEvent extends Event {
	readonly resultIndex: number;
	readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
	readonly length: number;
	item(index: number): SpeechRecognitionResult;
	[index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
	readonly isFinal: boolean;
	readonly length: number;
	item(index: number): SpeechRecognitionAlternative;
	[index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
	readonly transcript: string;
	readonly confidence: number;
}
