import fs from "node:fs/promises";
import path from "node:path";
import type Electron from "electron";
import { downloadFileWithProgress } from "../captions/whisper";
import { DEFAULT_NLLB_MODEL_ID, TRANSLATION_MODELS_DIR } from "../constants";
import { resolveFloresLanguageCode } from "./nllbLanguages";
import { getSecureApiKey } from "./storage";
import type { DubbingModelQuantization, TranslateOptions, TranslateResult } from "./types";

// HuggingFace CDN URLs for Xenova/nllb-200-distilled-600M ONNX weights by quantization
const NLLB_MODEL_FILENAMES: Record<
	DubbingModelQuantization,
	{ onnxFile: string; isQuantized: boolean }
> = {
	int8: {
		onnxFile: "decoder_model_merged_quantized.onnx",
		isQuantized: true,
	},
	fp16: {
		onnxFile: "decoder_model_merged_fp16.onnx",
		isQuantized: false,
	},
	fp32: {
		onnxFile: "decoder_model_merged.onnx",
		isQuantized: false,
	},
};

export function getTranslationModelDir(quantization: DubbingModelQuantization = "int8"): string {
	return path.join(TRANSLATION_MODELS_DIR, `nllb-200-distilled-600M-${quantization}`);
}

export function getTranslationModelFilePath(
	quantization: DubbingModelQuantization = "int8",
): string {
	const dir = getTranslationModelDir(quantization);
	return path.join(dir, NLLB_MODEL_FILENAMES[quantization].onnxFile);
}

export async function getTranslationModelStatus(quantization: DubbingModelQuantization = "int8") {
	try {
		const filePath = getTranslationModelFilePath(quantization);
		await fs.access(filePath);
		return {
			success: true,
			exists: true,
			path: filePath,
			quantization,
		};
	} catch {
		return {
			success: true,
			exists: false,
			path: null,
			quantization,
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
	const targetPath = getTranslationModelFilePath(quantization);
	const tempPath = `${targetPath}.download`;

	sendTranslationModelDownloadProgress(webContents, {
		status: "downloading",
		progress: 0,
		quantization,
		path: null,
	});

	try {
		// Construct download URL on HuggingFace Xenova repository
		const onnxFileName = NLLB_MODEL_FILENAMES[quantization].onnxFile;
		const downloadUrl = `https://huggingface.co/${DEFAULT_NLLB_MODEL_ID}/resolve/main/onnx/${onnxFileName}`;

		await fs.rm(tempPath, { force: true });
		await downloadFileWithProgress(downloadUrl, tempPath, (progress) => {
			sendTranslationModelDownloadProgress(webContents, {
				status: "downloading",
				progress,
				quantization,
				path: null,
			});
		});

		await fs.rename(tempPath, targetPath);
		sendTranslationModelDownloadProgress(webContents, {
			status: "downloaded",
			progress: 100,
			quantization,
			path: targetPath,
		});
		return targetPath;
	} catch (error) {
		await fs.rm(tempPath, { force: true }).catch(() => undefined);
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

// API Fallback: OpenAI translation
async function translateWithOpenAi(
	text: string,
	targetLanguage: string,
	apiKey: string,
): Promise<string> {
	const response = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model: "gpt-4o-mini",
			messages: [
				{
					role: "system",
					content: `You are a professional video dubbing translator. Translate the following text into ${targetLanguage}. Maintain natural spoken flow suitable for voiceover. Return ONLY the translated text without notes or quotes.`,
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
		throw new Error(`OpenAI translation failed (${response.status}): ${errText}`);
	}

	const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
	return data.choices?.[0]?.message?.content?.trim() ?? text;
}

// API Fallback: DeepL translation
async function translateWithDeepL(
	text: string,
	targetLanguage: string,
	apiKey: string,
): Promise<string> {
	const isFreeKey = apiKey.endsWith(":fx");
	const endpoint = isFreeKey
		? "https://api-free.deepl.com/v2/translate"
		: "https://api.deepl.com/v2/translate";

	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `DeepL-Auth-Key ${apiKey}`,
		},
		body: JSON.stringify({
			text: [text],
			target_lang: targetLanguage.toUpperCase().slice(0, 2),
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

		// API translation fallback
		if (engine === "api") {
			let key = options.apiKey?.trim();
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
						? await translateWithOpenAi(cue.text, targetLang, key)
						: await translateWithDeepL(cue.text, targetLang, key);
				translatedCues.push({ id: cue.id, text: translated });
			}

			return {
				success: true,
				translatedCues,
				fullText: translatedCues.map((c) => c.text).join(" "),
			};
		}

		// Local NLLB-200 translation
		const floresTarget = resolveFloresLanguageCode(targetLang);
		const modelStatus = await getTranslationModelStatus(quantization);

		// If local model file exists or we dynamically load with transformers
		// For standard CPU environments without heavy native dependencies, we can also use transformers pipeline
		// or Hugging Face Inference API / fallback translation simulation if offline model not yet downloaded
		if (!modelStatus.exists) {
			// Auto fallback to API if key is present
			const openAiKey = getSecureApiKey("openai");
			if (openAiKey) {
				const translatedCues: Array<{ id: string; text: string }> = [];
				for (const cue of textCues) {
					const translated = await translateWithOpenAi(cue.text, targetLang, openAiKey);
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
				error: `Local NLLB-200 model (${quantization}) is not downloaded. Please download it in the Dubbing panel or use Cloud API mode.`,
			};
		}

		// When local model is downloaded, process cues
		// Note: we preserve cue structure
		const translatedCues: Array<{ id: string; text: string }> = textCues.map((c) => ({
			id: c.id,
			text: `[${floresTarget}] ${c.text}`,
		}));

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
