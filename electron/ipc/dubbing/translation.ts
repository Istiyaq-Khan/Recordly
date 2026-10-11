import fs from "node:fs/promises";
import path from "node:path";
import type Electron from "electron";
import { DEFAULT_NLLB_MODEL_ID, TRANSLATION_MODELS_DIR } from "../constants";
import { resolveDeepLLanguageCode, resolveFloresLanguageCode } from "./nllbLanguages";
import { getCustomOpenAiConfig, getSecureApiKey } from "./storage";
import type { DubbingModelQuantization, TranslateOptions, TranslateResult } from "./types";

let activeTranslationPipeline: any = null;
let activeQuantization: DubbingModelQuantization | null = null;

export function getTranslationModelDir(quantization: DubbingModelQuantization = "int8"): string {
	return path.join(TRANSLATION_MODELS_DIR, `nllb-200-distilled-600M-${quantization}`);
}

export function getTranslationModelStatusFilePath(
	quantization: DubbingModelQuantization = "int8",
): string {
	return path.join(getTranslationModelDir(quantization), "model_ready.json");
}

export function getTranslationModelFilePath(
	quantization: DubbingModelQuantization = "int8",
): string {
	const filename =
		quantization === "int8"
			? "decoder_model_merged_quantized.onnx"
			: quantization === "fp16"
				? "decoder_model_merged_fp16.onnx"
				: "decoder_model_merged.onnx";
	return path.join(getTranslationModelDir(quantization), "onnx", filename);
}

export async function getTranslationModelStatus(quantization: DubbingModelQuantization = "int8") {
	try {
		const statusFile = getTranslationModelStatusFilePath(quantization);
		await fs.access(statusFile);
		return {
			success: true,
			exists: true,
			path: getTranslationModelDir(quantization),
			quantization,
		};
	} catch {
		// Also check if cache dir exists and has models
		try {
			const dir = getTranslationModelDir(quantization);
			const files = await fs.readdir(dir);
			if (files.length > 0) {
				return {
					success: true,
					exists: true,
					path: dir,
					quantization,
				};
			}
		} catch {
			// ignore
		}
		return {
			success: true,
			exists: false,
			path: null,
			quantization,
		};
	}
}

export async function deleteTranslationModel(
	quantization: DubbingModelQuantization = "int8",
): Promise<{ success: boolean; error?: string }> {
	try {
		const dir = getTranslationModelDir(quantization);
		await fs.rm(dir, { recursive: true, force: true });
		if (activeQuantization === quantization) {
			activeTranslationPipeline = null;
			activeQuantization = null;
		}
		return { success: true };
	} catch (error) {
		console.error("Failed to delete translation model:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function sendTranslationModelDownloadProgress(
	webContents: Electron.WebContents,
	payload: {
		status: "idle" | "downloading" | "downloaded" | "error";
		progress: number;
		quantization: DubbingModelQuantization;
		path?: string | null;
		error?: string;
	},
) {
	webContents.send("dubbing-translation-model-download-progress", payload);
}

export async function downloadTranslationModel(
	webContents: Electron.WebContents,
	quantization: DubbingModelQuantization = "int8",
): Promise<string> {
	const dir = getTranslationModelDir(quantization);
	await fs.mkdir(dir, { recursive: true });

	sendTranslationModelDownloadProgress(webContents, {
		status: "downloading",
		progress: 0,
		quantization,
		path: null,
	});

	try {
		const { pipeline, env } = await import("@huggingface/transformers");
		env.cacheDir = TRANSLATION_MODELS_DIR;
		const dtype = quantization === "fp16" ? "fp16" : "q8";

		const pipe = await pipeline("translation", DEFAULT_NLLB_MODEL_ID, {
			dtype,
			progress_callback: (info: any) => {
				if (info && typeof info.progress === "number") {
					sendTranslationModelDownloadProgress(webContents, {
						status: "downloading",
						progress: Math.min(100, Math.max(0, Math.round(info.progress))),
						quantization,
						path: null,
					});
				}
			},
		});

		activeTranslationPipeline = pipe;
		activeQuantization = quantization;

		const statusFile = getTranslationModelStatusFilePath(quantization);
		await fs.writeFile(
			statusFile,
			JSON.stringify(
				{
					quantization,
					dtype,
					modelId: DEFAULT_NLLB_MODEL_ID,
					installedAt: Date.now(),
				},
				null,
				2,
			),
		);

		sendTranslationModelDownloadProgress(webContents, {
			status: "downloaded",
			progress: 100,
			quantization,
			path: dir,
		});

		return dir;
	} catch (error) {
		console.error("Failed to download/initialize NLLB-200 translation model:", error);
		sendTranslationModelDownloadProgress(webContents, {
			status: "error",
			progress: 0,
			quantization,
			path: null,
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

// API Fallback: OpenAI translation with custom endpoint support
async function translateWithOpenAi(
	text: string,
	targetLanguage: string,
	apiKey: string,
	customConfig?: { baseUrl?: string | null; model?: string | null },
): Promise<string> {
	const rawBaseUrl = customConfig?.baseUrl?.trim() || "https://api.openai.com/v1";
	const baseUrl = rawBaseUrl.replace(/\/+$/, "");
	const endpoint = baseUrl.endsWith("/chat/completions")
		? baseUrl
		: `${baseUrl}/chat/completions`;
	const model = customConfig?.model?.trim() || "gpt-4o-mini";

	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			messages: [
				{
					role: "system",
					content: `You are a professional video dubbing translator. Translate the following spoken video transcript into ${targetLanguage}. Maintain natural spoken flow, brevity, and timing suitable for voiceover. Return ONLY the translated text without notes or quotes.`,
				},
				{
					role: "user",
					content: text,
				},
			],
			temperature: 0.3,
		}),
	});

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(
			`OpenAI-compatible translation failed (${response.status}) at ${endpoint}: ${errText}`,
		);
	}

	const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
	return data.choices?.[0]?.message?.content?.trim() ?? text;
}

// API Fallback: DeepL translation with normalized BCP-47 codes
async function translateWithDeepL(
	text: string,
	targetLanguage: string,
	apiKey: string,
): Promise<string> {
	const isFreeKey = apiKey.endsWith(":fx");
	const endpoint = isFreeKey
		? "https://api-free.deepl.com/v2/translate"
		: "https://api.deepl.com/v2/translate";

	const targetLangCode = resolveDeepLLanguageCode(targetLanguage);

	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `DeepL-Auth-Key ${apiKey}`,
		},
		body: JSON.stringify({
			text: [text],
			target_lang: targetLangCode,
		}),
	});

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(`DeepL translation failed (${response.status}): ${errText}`);
	}

	const data = (await response.json()) as { translations?: Array<{ text?: string }> };
	return data.translations?.[0]?.text?.trim() ?? text;
}

export async function translateTranscript(options: TranslateOptions): Promise<TranslateResult> {
	try {
		const {
			textCues,
			targetLang,
			engine = "local-nllb",
			quantization = "int8",
			apiProvider = "openai",
		} = options;

		if (!textCues || textCues.length === 0) {
			return { success: true, translatedCues: [], fullText: "" };
		}

		// API translation mode
		if (engine === "api") {
			const customOpenAiConfig = options.customOpenAiConfig ?? getCustomOpenAiConfig();
			let key = options.apiKey?.trim();
			if (!key && apiProvider === "openai" && customOpenAiConfig?.apiKey) {
				key = customOpenAiConfig.apiKey.trim();
			}
			if (!key) {
				key = getSecureApiKey(apiProvider) ?? undefined;
			}
			if (!key) {
				return {
					success: false,
					error: `No API key configured for ${apiProvider}. Enter an API key in dubbing settings.`,
				};
			}

			const translatedCues: Array<{ id: string; text: string }> = [];
			for (const cue of textCues) {
				const translated =
					apiProvider === "openai"
						? await translateWithOpenAi(cue.text, targetLang, key, customOpenAiConfig)
						: await translateWithDeepL(cue.text, targetLang, key);
				translatedCues.push({ id: cue.id, text: translated });
			}

			return {
				success: true,
				translatedCues,
				fullText: translatedCues.map((c) => c.text).join(" "),
			};
		}

		// Local Model (NLLB-200 via Transformers.js)
		const floresTarget = resolveFloresLanguageCode(targetLang);
		const floresSource = resolveFloresLanguageCode(options.sourceLang || "en");
		const modelStatus = await getTranslationModelStatus(quantization);

		if (!modelStatus.exists && !activeTranslationPipeline) {
			// Auto fallback to API if key is present
			const openAiKey = getSecureApiKey("openai");
			if (openAiKey) {
				const customOpenAiConfig = options.customOpenAiConfig ?? getCustomOpenAiConfig();
				const translatedCues: Array<{ id: string; text: string }> = [];
				for (const cue of textCues) {
					const translated = await translateWithOpenAi(
						cue.text,
						targetLang,
						openAiKey,
						customOpenAiConfig,
					);
					translatedCues.push({ id: cue.id, text: translated });
				}
				return {
					success: true,
					translatedCues,
					fullText: translatedCues.map((c) => c.text).join(" "),
				};
			}

			return {
				success: false,
				error: `Local Model (${quantization}) is not downloaded. Please click Download in the Dubbing panel or use Cloud API mode.`,
			};
		}

		// Run genuine local model inference with Transformers.js pipeline
		const dtype = quantization === "fp16" ? "fp16" : "q8";
		if (!activeTranslationPipeline || activeQuantization !== quantization) {
			const { pipeline, env } = await import("@huggingface/transformers");
			env.cacheDir = TRANSLATION_MODELS_DIR;
			activeTranslationPipeline = await pipeline("translation", DEFAULT_NLLB_MODEL_ID, {
				dtype,
			});
			activeQuantization = quantization;
		}

		const translatedCues: Array<{ id: string; text: string }> = [];
		for (const cue of textCues) {
			try {
				const output = await activeTranslationPipeline(cue.text, {
					src_lang: floresSource,
					tgt_lang: floresTarget,
				});
				const translatedText =
					output?.[0]?.translation_text?.trim() || output?.[0]?.text?.trim() || cue.text;
				translatedCues.push({ id: cue.id, text: translatedText });
			} catch (inferError) {
				console.warn(`Local inference error on cue "${cue.text}":`, inferError);
				translatedCues.push({ id: cue.id, text: cue.text });
			}
		}

		return {
			success: true,
			translatedCues,
			fullText: translatedCues.map((c) => c.text).join(" "),
		};
	} catch (error) {
		console.error("Translation failed:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
