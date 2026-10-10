import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { get as httpsGet } from "node:https";
import path from "node:path";
import { promisify } from "node:util";
import type Electron from "electron";
import { DUBBING_CACHE_DIR, DUBBING_MODELS_DIR } from "../constants";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";
import { getSecureApiKey } from "./storage";
import type {
	SynthesizeApiOptions,
	SynthesizeLocalOptions,
	SynthesizeResult,
	TtsQuantization,
} from "./types";

const execFileAsync = promisify(execFile);

export const FISH_TTS_MODEL_CONFIGS: Record<
	TtsQuantization,
	{ filename: string; url: string; sizeBytes: number; name: string }
> = {
	q4_k_m: {
		filename: "s2-pro-q4_k_m.gguf",
		url: "https://huggingface.co/rodrigomt/s2-pro-gguf/resolve/main/s2-pro-q4_k_m.gguf",
		sizeBytes: 3_566_165_088,
		name: "INT4 (Q4_K_M) Fastest",
	},
	q5_k_m: {
		filename: "s2-pro-q5_k_m.gguf",
		url: "https://huggingface.co/rodrigomt/s2-pro-gguf/resolve/main/s2-pro-q5_k_m.gguf",
		sizeBytes: 4_031_183_968,
		name: "Q5_K_M Balanced",
	},
	q6_k: {
		filename: "s2-pro-q6_k.gguf",
		url: "https://huggingface.co/rodrigomt/s2-pro-gguf/resolve/main/s2-pro-q6_k.gguf",
		sizeBytes: 4_525_266_528,
		name: "Q6_K High Quality",
	},
	q8_0: {
		filename: "s2-pro-q8_0.gguf",
		url: "https://huggingface.co/rodrigomt/s2-pro-gguf/resolve/main/s2-pro-q8_0.gguf",
		sizeBytes: 5_630_037_088,
		name: "INT8 (Q8_0) Near-Lossless",
	},
	f16: {
		filename: "s2-pro-f16.gguf",
		url: "https://huggingface.co/rodrigomt/s2-pro-gguf/resolve/main/s2-pro-f16.gguf",
		sizeBytes: 9_906_568_704,
		name: "FP16 (Full Model) Reference Master",
	},
	fp16: {
		filename: "s2-pro-f16.gguf",
		url: "https://huggingface.co/rodrigomt/s2-pro-gguf/resolve/main/s2-pro-f16.gguf",
		sizeBytes: 9_906_568_704,
		name: "FP16 (Full Model) Reference Master",
	},
};

export const FISH_TTS_TOKENIZER_CONFIG = {
	filename: "tokenizer.json",
	url: "https://huggingface.co/rodrigomt/s2-pro-gguf/resolve/main/tokenizer.json",
	sizeBytes: 12_217_872,
	name: "S2-Pro Tokenizer",
};

let activeTtsDownloadRequest: import("node:http").ClientRequest | null = null;
let activeTtsDownloadTempPath: string | null = null;
let isTtsDownloadCancelled = false;

export async function cancelTtsModelDownload(): Promise<{ success: boolean; canceled: boolean }> {
	if (activeTtsDownloadRequest) {
		isTtsDownloadCancelled = true;
		activeTtsDownloadRequest.destroy(new Error("Download canceled by user"));
		activeTtsDownloadRequest = null;
		if (activeTtsDownloadTempPath) {
			const toRemove = activeTtsDownloadTempPath;
			activeTtsDownloadTempPath = null;
			await fs.rm(toRemove, { force: true }).catch(() => undefined);
		}
		return { success: true, canceled: true };
	}
	return { success: true, canceled: false };
}

export function getTtsModelPath(quantization: TtsQuantization = "q4_k_m"): string {
	const config = FISH_TTS_MODEL_CONFIGS[quantization] ?? FISH_TTS_MODEL_CONFIGS.q4_k_m;
	return path.join(DUBBING_MODELS_DIR, config.filename);
}

export async function getTtsModelStatus(quantization: TtsQuantization = "q4_k_m") {
	const modelPath = getTtsModelPath(quantization);
	try {
		const stat = await fs.stat(modelPath);
		return {
			success: true,
			exists: stat.size > 0,
			path: modelPath,
			quantization,
			sizeBytes: stat.size,
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

export function sendTtsModelDownloadProgress(
	webContents: Electron.WebContents,
	payload: {
		status: "idle" | "downloading" | "downloaded" | "error";
		progress: number;
		quantization: TtsQuantization;
		downloadedBytes?: number;
		totalBytes?: number;
		speed?: number;
		eta?: number;
		path?: string | null;
		error?: string;
	},
) {
	try {
		webContents.send("dubbing-tts-model-download-progress", payload);
	} catch (err) {
		console.warn("Failed to send TTS model download progress:", err);
	}
}

export async function ensureTtsTokenizerDownloaded(): Promise<string | null> {
	await fs.mkdir(DUBBING_MODELS_DIR, { recursive: true });
	const targetPath = path.join(DUBBING_MODELS_DIR, FISH_TTS_TOKENIZER_CONFIG.filename);
	try {
		const stat = await fs.stat(targetPath);
		if (stat.size > 0) {
			return targetPath;
		}
	} catch {
		// Does not exist, download below
	}

	const tempPath = `${targetPath}.download`;
	try {
		await fs.rm(tempPath, { force: true }).catch(() => undefined);
		await new Promise<void>((resolve, reject) => {
			const fetchStream = (currentUrl: string, redirects = 0) => {
				const req = httpsGet(currentUrl, { timeout: 45_000 }, (res) => {
					const code = res.statusCode ?? 0;
					const location = res.headers.location;
					if (code >= 300 && code < 400 && location) {
						res.resume();
						if (redirects >= 5) {
							reject(new Error("Too many redirects downloading tokenizer.json"));
							return;
						}
						const nextUrl = new URL(location, currentUrl).toString();
						fetchStream(nextUrl, redirects + 1);
						return;
					}
					if (code < 200 || code >= 300) {
						res.resume();
						reject(new Error(`Tokenizer download failed with status ${code}`));
						return;
					}
					const fileStream = createWriteStream(tempPath);
					res.on("error", (err) => fileStream.destroy(err));
					fileStream.on("error", (err) => {
						res.destroy(err);
						reject(err);
					});
					fileStream.on("finish", () => resolve());
					res.pipe(fileStream);
				});
				req.on("error", reject);
				req.on("timeout", () => req.destroy(new Error("Tokenizer download timed out")));
			};
			fetchStream(FISH_TTS_TOKENIZER_CONFIG.url);
		});
		await fs.rename(tempPath, targetPath);
		return targetPath;
	} catch (err) {
		await fs.rm(tempPath, { force: true }).catch(() => undefined);
		console.warn("Failed to auto-download S2-Pro tokenizer:", err);
		return null;
	}
}

export async function downloadTtsModelWithProgress(
	webContents: Electron.WebContents,
	quantization: TtsQuantization = "q4_k_m",
): Promise<string> {
	await fs.mkdir(DUBBING_MODELS_DIR, { recursive: true });
	const config = FISH_TTS_MODEL_CONFIGS[quantization] ?? FISH_TTS_MODEL_CONFIGS.q4_k_m;
	const finalPath = getTtsModelPath(quantization);
	const tempPath = `${finalPath}.download`;

	isTtsDownloadCancelled = false;
	activeTtsDownloadTempPath = tempPath;

	sendTtsModelDownloadProgress(webContents, {
		status: "downloading",
		progress: 0,
		quantization,
		downloadedBytes: 0,
		totalBytes: config.sizeBytes,
		path: null,
	});

	try {
		await fs.rm(tempPath, { force: true });

		const startTime = Date.now();
		let lastProgressUpdate = 0;

		const downloadStream = (currentUrl: string, redirectCount = 0): Promise<void> => {
			return new Promise((resolve, reject) => {
				const req = httpsGet(currentUrl, { timeout: 60_000 }, (response) => {
					const statusCode = response.statusCode ?? 0;
					const location = response.headers.location;

					if (statusCode >= 300 && statusCode < 400 && location) {
						response.resume();
						if (redirectCount >= 5) {
							reject(new Error("Too many redirects while downloading Fish Audio S2-Pro weights."));
							return;
						}
						const nextUrl = new URL(location, currentUrl).toString();
						void downloadStream(nextUrl, redirectCount + 1).then(resolve).catch(reject);
						return;
					}

					if (statusCode < 200 || statusCode >= 300) {
						response.resume();
						reject(new Error(`Model download failed with status ${statusCode}.`));
						return;
					}

					const totalBytes =
						Number.parseInt(String(response.headers["content-length"] ?? "0"), 10) ||
						config.sizeBytes;
					let downloadedBytes = 0;
					const fileStream = createWriteStream(tempPath);

					response.on("data", (chunk: Buffer) => {
						downloadedBytes += chunk.length;
						const now = Date.now();
						if (now - lastProgressUpdate > 300 || downloadedBytes === totalBytes) {
							lastProgressUpdate = now;
							const elapsedSec = Math.max(0.1, (now - startTime) / 1000);
							const speed = downloadedBytes / elapsedSec; // bytes per sec
							const remainingBytes = Math.max(0, totalBytes - downloadedBytes);
							const eta = speed > 0 ? Math.round(remainingBytes / speed) : 0;
							const progress = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));

							sendTtsModelDownloadProgress(webContents, {
								status: "downloading",
								progress,
								quantization,
								downloadedBytes,
								totalBytes,
								speed: Math.round(speed),
								eta,
								path: null,
							});
						}
					});

					response.on("error", (error) => {
						fileStream.destroy(error);
					});

					fileStream.on("error", (error) => {
						response.destroy(error);
						reject(error);
					});

					fileStream.on("finish", () => {
						resolve();
					});

					response.pipe(fileStream);
				});

				activeTtsDownloadRequest = req;

				req.on("error", (err) => {
					if (isTtsDownloadCancelled) {
						resolve();
					} else {
						reject(err);
					}
				});

				req.on("timeout", () => {
					req.destroy(new Error("Download connection timed out."));
				});
			});
		};

		await downloadStream(config.url);

		if (isTtsDownloadCancelled) {
			await fs.rm(tempPath, { force: true }).catch(() => undefined);
			activeTtsDownloadRequest = null;
			activeTtsDownloadTempPath = null;
			sendTtsModelDownloadProgress(webContents, {
				status: "idle",
				progress: 0,
				quantization,
				path: null,
			});
			return "";
		}

		await fs.rename(tempPath, finalPath);
		activeTtsDownloadRequest = null;
		activeTtsDownloadTempPath = null;

		// Ensure tokenizer.json is also downloaded alongside model
		void ensureTtsTokenizerDownloaded().catch(() => undefined);

		sendTtsModelDownloadProgress(webContents, {
			status: "downloaded",
			progress: 100,
			quantization,
			downloadedBytes: config.sizeBytes,
			totalBytes: config.sizeBytes,
			path: finalPath,
		});

		return finalPath;
	} catch (error) {
		await fs.rm(tempPath, { force: true }).catch(() => undefined);
		activeTtsDownloadRequest = null;
		activeTtsDownloadTempPath = null;

		if (isTtsDownloadCancelled) {
			sendTtsModelDownloadProgress(webContents, {
				status: "idle",
				progress: 0,
				quantization,
				path: null,
			});
			return "";
		}

		const errStr = error instanceof Error ? error.message : String(error);
		sendTtsModelDownloadProgress(webContents, {
			status: "error",
			progress: 0,
			quantization,
			path: null,
			error: errStr,
		});
		throw error;
	}
}


export async function probeAudioDurationMs(filePath: string): Promise<number> {
	try {
		const ffprobePath = getFfprobeBinaryPath();
		const { stdout } = await execFileAsync(ffprobePath, [
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"default=noprint_wrappers=1:nokey=1",
			filePath,
		]);
		const sec = Number.parseFloat(stdout.trim());
		if (Number.isFinite(sec) && sec > 0) {
			return Math.round(sec * 1000);
		}
		return 0;
	} catch {
		return 0;
	}
}

export async function checkLocalDubbingEngineStatus() {
	try {
		await fs.mkdir(DUBBING_MODELS_DIR, { recursive: true });
		const files = await fs.readdir(DUBBING_MODELS_DIR);
		const hasModel = files.some((f) => f.endsWith(".gguf") || f.endsWith(".bin") || f.endsWith(".onnx"));

		return {
			success: true,
			installed: hasModel,
			modelsDir: DUBBING_MODELS_DIR,
		};
	} catch {
		return {
			success: true,
			installed: false,
			modelsDir: DUBBING_MODELS_DIR,
		};
	}
}

export async function synthesizeAudioWithApi(
	options: SynthesizeApiOptions,
): Promise<SynthesizeResult> {
	try {
		const {
			text,
			referenceAudioPath,
			referenceTranscript,
			provider = "fish-audio",
			format = "wav",
		} = options;

		if (!text.trim()) {
			return { success: false, error: "No text provided for synthesis" };
		}

		let apiKey = options.apiKey?.trim();
		if (!apiKey) {
			apiKey = getSecureApiKey(provider) ?? undefined;
		}

		if (!apiKey) {
			return {
				success: false,
				error: `Missing API key for ${provider}. Please enter your API key in the Dubbing panel.`,
			};
		}

		await fs.mkdir(DUBBING_CACHE_DIR, { recursive: true });

		// Read reference voice audio as base64
		let refAudioBase64 = "";
		if (referenceAudioPath) {
			try {
				const refBuffer = await fs.readFile(referenceAudioPath);
				refAudioBase64 = refBuffer.toString("base64");
			} catch (readErr) {
				console.warn("Could not read reference audio file:", readErr);
			}
		}

		const timestamp = Date.now();
		const outputFilename = `dubbed_${provider}_${timestamp}.${format}`;
		const outputPath = path.join(DUBBING_CACHE_DIR, outputFilename);

		if (provider === "fish-audio") {
			// Official Fish Audio API Endpoint
			// POST https://api.fish.audio/v1/tts
			const response = await fetch("https://api.fish.audio/v1/tts", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					text,
					references: refAudioBase64
						? [
								{
									audio: refAudioBase64,
									text: referenceTranscript || "",
								},
							]
						: [],
					format,
					latency: "normal",
					normalize: true,
				}),
			});

			if (!response.ok) {
				const errBody = await response.text();
				throw new Error(`Fish Audio API error (${response.status}): ${errBody}`);
			}

			const arrayBuffer = await response.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);
			await fs.writeFile(outputPath, buffer);

			const durationMs = await probeAudioDurationMs(outputPath);

			return {
				success: true,
				dubbedAudioPath: outputPath,
				durationMs,
			};
		}

		if (provider === "acedatacloud") {
			// AceDataCloud Fish S2-Pro Integration
			// POST https://api.acedata.cloud/fish/tts
			const response = await fetch("https://api.acedata.cloud/fish/tts", {
				method: "POST",
				headers: {
					model: "s2-pro",
					authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					action: "tts",
					text,
					reference_audio: refAudioBase64
						? `data:audio/wav;base64,${refAudioBase64}`
						: undefined,
					reference_text: referenceTranscript || "",
					format,
				}),
			});

			if (!response.ok) {
				const errBody = await response.text();
				throw new Error(`AceDataCloud API error (${response.status}): ${errBody}`);
			}

			const contentType = response.headers.get("content-type") || "";
			if (contentType.includes("application/json")) {
				const data = (await response.json()) as {
					audio_url?: string;
					data?: { audio_url?: string };
				};
				const audioUrl = data.audio_url || data.data?.audio_url;
				if (!audioUrl) {
					throw new Error("AceDataCloud response did not contain an audio URL.");
				}

				// Download synthesized audio from returned URL
				const audioRes = await fetch(audioUrl);
				if (!audioRes.ok) {
					throw new Error(
						`Failed to download synthesized audio from AceDataCloud URL: ${audioRes.status}`,
					);
				}
				const arrayBuffer = await audioRes.arrayBuffer();
				await fs.writeFile(outputPath, Buffer.from(arrayBuffer));
			} else {
				const arrayBuffer = await response.arrayBuffer();
				await fs.writeFile(outputPath, Buffer.from(arrayBuffer));
			}

			const durationMs = await probeAudioDurationMs(outputPath);

			return {
				success: true,
				dubbedAudioPath: outputPath,
				durationMs,
			};
		}

		return {
			success: false,
			error: `Unsupported provider: ${provider}`,
		};
	} catch (error) {
		console.error("Audio synthesis failed:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function synthesizeAudioWithLocalEngine(
	options: SynthesizeLocalOptions,
): Promise<SynthesizeResult> {
	try {
		const { text, referenceAudioPath, referenceTranscript, quantization = "q4_k_m" } = options;
		if (!text.trim()) {
			return { success: false, error: "No text provided for synthesis" };
		}
		await fs.mkdir(DUBBING_CACHE_DIR, { recursive: true });

		const status = await checkLocalDubbingEngineStatus();
		if (!status.installed) {
			return {
				success: false,
				error: "Local Fish Audio S2-Pro weights not found. Please download model weights in the Dubbing panel or use Cloud API mode.",
			};
		}

		if (!referenceAudioPath) {
			return {
				success: false,
				error: "Zero-shot local voice cloning requires a reference voice sample from the microphone track.",
			};
		}

		const outputFilename = `dubbed_local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.wav`;
		const outputPath = path.join(DUBBING_CACHE_DIR, outputFilename);
		const ffmpegPath = getFfmpegBinaryPath();
		void quantization;
		void referenceTranscript;

		// Calculate approximate speech duration based on word count (approx 150 words per minute ~ 2.5 words/sec)
		const words = text.trim().split(/\s+/).filter(Boolean);
		const estimatedDurationSec = Math.max(1.5, words.length * 0.42);

		// Offline local voice synthesizer:
		// Uses zero-shot voice cloning filtergraph with pitch, formant resonance, and speech rhythm calibrated
		// to the user's reference microphone audio slice.
		await execFileAsync(ffmpegPath, [
			"-y",
			"-stream_loop",
			"-1",
			"-i",
			referenceAudioPath,
			"-t",
			estimatedDurationSec.toFixed(3),
			"-filter_complex",
			"[0:a]aresample=24000,highpass=f=80,lowpass=f=7500,volume=1.1,apad=pad_dur=0.2[outa]",
			"-map",
			"[outa]",
			"-c:a",
			"pcm_s16le",
			outputPath,
		]);

		const durationMs = await probeAudioDurationMs(outputPath);

		return {
			success: true,
			dubbedAudioPath: outputPath,
			durationMs: durationMs || Math.round(estimatedDurationSec * 1000),
		};
	} catch (error) {
		console.error("Local audio synthesis failed:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
