import type { CaptionCue } from "../../../src/components/video-editor/types";

export type DubbingModelQuantization = "int8" | "fp16" | "fp32";
export type DubbingTtsBackend = "cloud" | "local";
export type DubbingCloudProvider = "fish-audio" | "acedatacloud";
export type DubbingTranslationEngine = "local-nllb" | "api";
export type DubbingApiTranslationProvider = "openai" | "deepl";
export type SupportedApiKeyProvider = "fish-audio" | "acedatacloud" | "openai" | "deepl";

export interface DubbingLanguage {
	code: string; // ISO 639-1 or standard locale (e.g., "es", "fr", "bn")
	floresCode: string; // Flores-200 code for NLLB-200 (e.g., "spa_Latn", "fra_Latn", "ben_Beng")
	name: string; // English name (e.g., "Spanish")
	nativeName: string; // Native name (e.g., "Español")
}

export type TtsQuantization = "q4_k_m" | "q8_0" | "fp16";

export interface DubbingStatus {
	localModelReady: boolean;
	localModelQuantization: DubbingModelQuantization | null;
	localEngineInstalled: boolean;
	hasFishApiKey: boolean;
	hasAceDataApiKey: boolean;
	hasOpenAiApiKey: boolean;
	hasDeepLApiKey: boolean;
	customOpenAiConfig?: {
		baseUrl: string | null;
		model: string | null;
	};
}

export interface ExtractVoiceReferenceOptions {
	videoPath?: string;
	audioPath?: string;
	startMs?: number;
	durationMs?: number;
	existingCues?: CaptionCue[];
}

export interface ExtractVoiceReferenceResult {
	success: boolean;
	referenceAudioPath?: string;
	durationMs?: number;
	suggestedTranscript?: string;
	sourceType?: "timeline" | "upload" | "record";
	error?: string;
	canceled?: boolean;
}

export interface ImportVoiceReferenceFileOptions {
	filePath?: string;
	whisperExecutablePath?: string | null;
	whisperModelPath?: string | null;
}

export interface SaveLiveVoiceReferenceOptions {
	audioBuffer: Uint8Array | ArrayBuffer | number[] | string;
	mimeType?: string;
	promptText?: string;
	whisperExecutablePath?: string | null;
	whisperModelPath?: string | null;
}

export interface TranscribeAudioSampleOptions {
	audioPath: string;
	whisperExecutablePath?: string | null;
	whisperModelPath?: string | null;
	language?: string;
}

export interface TranscribeAudioSampleResult {
	success: boolean;
	transcript?: string;
	error?: string;
}

export interface TranslateOptions {
	textCues: Array<{ id: string; text: string }>;
	sourceLang?: string;
	targetLang: string;
	engine: DubbingTranslationEngine;
	quantization?: DubbingModelQuantization;
	apiProvider?: DubbingApiTranslationProvider;
	customOpenAiConfig?: { apiKey?: string; baseUrl?: string; model?: string };
	apiKey?: string;
}

export interface TranslateResult {
	success: boolean;
	translatedCues?: Array<{ id: string; text: string }>;
	fullText?: string;
	error?: string;
}

export interface SynthesizeApiOptions {
	text: string;
	referenceAudioPath: string;
	referenceTranscript: string;
	provider: DubbingCloudProvider;
	targetLanguage?: string;
	apiKey?: string;
	format?: "wav";
}

export interface SynthesizeLocalOptions {
	text: string;
	referenceAudioPath: string;
	referenceTranscript: string;
	targetLanguage?: string;
	quantization?: TtsQuantization;
}

export interface SynthesizeResult {
	success: boolean;
	dubbedAudioPath?: string;
	durationMs?: number;
	error?: string;
}

export interface AlignCaptionsOptions {
	dubbedAudioPath: string;
	targetLanguage: string;
	whisperExecutablePath?: string;
	whisperModelPath?: string;
}

export interface AlignCaptionsResult {
	success: boolean;
	cues?: CaptionCue[];
	error?: string;
}
