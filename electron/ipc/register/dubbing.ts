import { ipcMain } from "electron";
import { alignDubbedCaptions } from "../dubbing/captionAlignment";
import {
	checkLocalDubbingEngineStatus,
	downloadTtsModelWithProgress,
	getTtsModelStatus,
	synthesizeAudioWithApi,
	synthesizeAudioWithLocalEngine,
} from "../dubbing/fishAudio";
import { SUPPORTED_DUBBING_LANGUAGES } from "../dubbing/nllbLanguages";
import {
	extractVoiceReferenceSample,
	importVoiceReferenceFile,
	saveLiveVoiceReference,
	transcribeVoiceReferenceSample,
} from "../dubbing/referenceAudio";
import {
	getCustomOpenAiConfig,
	hasSecureApiKey,
	saveCustomOpenAiConfig,
	saveSecureApiKey,
} from "../dubbing/storage";
import {
	downloadTranslationModel,
	getTranslationModelStatus,
	translateTranscript,
} from "../dubbing/translation";
import type {
	AlignCaptionsOptions,
	DubbingModelQuantization,
	ExtractVoiceReferenceOptions,
	ImportVoiceReferenceFileOptions,
	SaveLiveVoiceReferenceOptions,
	SupportedApiKeyProvider,
	SynthesizeApiOptions,
	SynthesizeLocalOptions,
	TranscribeAudioSampleOptions,
	TranslateOptions,
	TtsQuantization,
} from "../dubbing/types";

export function registerDubbingHandlers() {
	ipcMain.handle("dubbing:get-status", async () => {
		const int8Status = await getTranslationModelStatus("int8");
		const fp16Status = await getTranslationModelStatus("fp16");
		const fp32Status = await getTranslationModelStatus("fp32");
		const localEngine = await checkLocalDubbingEngineStatus();

		return {
			localModelReady: int8Status.exists || fp16Status.exists || fp32Status.exists,
			localModelQuantization: int8Status.exists
				? "int8"
				: fp16Status.exists
					? "fp16"
					: fp32Status.exists
						? "fp32"
						: null,
			localEngineInstalled: localEngine.installed,
			hasFishApiKey: hasSecureApiKey("fish-audio"),
			hasAceDataApiKey: hasSecureApiKey("acedatacloud"),
			hasOpenAiApiKey: hasSecureApiKey("openai"),
			hasDeepLApiKey: hasSecureApiKey("deepl"),
			customOpenAiConfig: getCustomOpenAiConfig(),
		};
	});

	ipcMain.handle("dubbing:get-supported-languages", () => {
		return SUPPORTED_DUBBING_LANGUAGES;
	});

	ipcMain.handle(
		"dubbing:get-translation-model-status",
		async (_, quantization?: DubbingModelQuantization) => {
			return await getTranslationModelStatus(quantization ?? "int8");
		},
	);

	ipcMain.handle(
		"dubbing:download-translation-model",
		async (event, quantization?: DubbingModelQuantization) => {
			try {
				const modelPath = await downloadTranslationModel(
					event.sender,
					quantization ?? "int8",
				);
				return { success: true, path: modelPath };
			} catch (error) {
				console.error("Failed to download translation model:", error);
				return { success: false, error: String(error) };
			}
		},
	);

	ipcMain.handle(
		"dubbing:get-tts-model-status",
		async (_, quantization?: TtsQuantization) => {
			return await getTtsModelStatus(quantization ?? "q4_k_m");
		},
	);

	ipcMain.handle(
		"dubbing:download-tts-model",
		async (event, quantization?: TtsQuantization) => {
			try {
				const modelPath = await downloadTtsModelWithProgress(
					event.sender,
					quantization ?? "q4_k_m",
				);
				return { success: true, path: modelPath };
			} catch (error) {
				console.error("Failed to download Fish Audio TTS model:", error);
				return { success: false, error: String(error) };
			}
		},
	);

	ipcMain.handle(
		"dubbing:extract-voice-reference",
		async (_, options: ExtractVoiceReferenceOptions) => {
			return await extractVoiceReferenceSample(options);
		},
	);

	ipcMain.handle(
		"dubbing:import-voice-reference-file",
		async (_, options?: ImportVoiceReferenceFileOptions) => {
			return await importVoiceReferenceFile(options ?? {});
		},
	);

	ipcMain.handle(
		"dubbing:save-live-voice-reference",
		async (_, options: SaveLiveVoiceReferenceOptions) => {
			return await saveLiveVoiceReference(options);
		},
	);

	ipcMain.handle(
		"dubbing:transcribe-sample",
		async (_, options: TranscribeAudioSampleOptions) => {
			return await transcribeVoiceReferenceSample(options);
		},
	);

	ipcMain.handle("dubbing:translate", async (_, options: TranslateOptions) => {
		return await translateTranscript(options);
	});

	ipcMain.handle("dubbing:synthesize-api", async (_, options: SynthesizeApiOptions) => {
		return await synthesizeAudioWithApi(options);
	});

	ipcMain.handle("dubbing:synthesize-local", async (_, options: SynthesizeLocalOptions) => {
		return await synthesizeAudioWithLocalEngine(options);
	});

	ipcMain.handle("dubbing:align-captions", async (_, options: AlignCaptionsOptions) => {
		return await alignDubbedCaptions(options);
	});

	ipcMain.handle(
		"dubbing:save-api-key",
		(_, { provider, key }: { provider: SupportedApiKeyProvider; key: string }) => {
			const success = saveSecureApiKey(provider, key);
			return { success };
		},
	);

	ipcMain.handle("dubbing:get-api-keys", () => {
		return {
			"fish-audio": hasSecureApiKey("fish-audio"),
			acedatacloud: hasSecureApiKey("acedatacloud"),
			openai: hasSecureApiKey("openai"),
			deepl: hasSecureApiKey("deepl"),
		};
	});

	ipcMain.handle(
		"dubbing:save-custom-openai-config",
		(_, config: { baseUrl?: string | null; model?: string | null }) => {
			const success = saveCustomOpenAiConfig(config);
			return { success };
		},
	);
}
