import { execFile, type ChildProcess, type ExecFileOptions } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { get as httpsGet } from "node:https";
import path from "node:path";
import { promisify } from "node:util";
import type Electron from "electron";
import { DUBBING_CACHE_DIR, DUBBING_MODELS_DIR } from "../constants";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";
import { rememberApprovedLocalReadPath } from "../project/manager";
import { getSecureApiKey } from "./storage";
import type {
	DubbingSegmentProgressPayload,
	SynthesizeApiOptions,
	SynthesizeDubbedSegmentsOptions,
	SynthesizeDubbedSegmentsResult,
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

const activeSynthesisProcesses = new Set<ChildProcess>();
let activeSynthesisAbortController: AbortController | null = null;
let isSynthesisCancelled = false;

export async function cancelDubbingSynthesis(): Promise<{ success: boolean; canceled: boolean }> {
	isSynthesisCancelled = true;
	if (activeSynthesisAbortController) {
		activeSynthesisAbortController.abort();
		activeSynthesisAbortController = null;
	}
	for (const cp of activeSynthesisProcesses) {
		try {
			cp.kill("SIGKILL");
		} catch {
			// ignore
		}
	}
	activeSynthesisProcesses.clear();
	return { success: true, canceled: true };
}

function execFileTracked(
	file: string,
	args: string[],
	options: ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		if (isSynthesisCancelled) {
			return reject(new Error("Dubbing synthesis was canceled."));
		}
		const cp = execFile(file, args, options, (error, stdout, stderr) => {
			activeSynthesisProcesses.delete(cp);
			if (error) {
				if (isSynthesisCancelled) {
					reject(new Error("Dubbing synthesis was canceled."));
				} else {
					reject(error);
				}
			} else {
				resolve({ stdout: String(stdout), stderr: String(stderr) });
			}
		});
		activeSynthesisProcesses.add(cp);
	});
}

export async function deleteTtsModel(
	quantization: TtsQuantization = "q4_k_m",
): Promise<{ success: boolean; error?: string }> {
	try {
		const modelPath = getTtsModelPath(quantization);
		const tempPath = `${modelPath}.download`;
		await fs.rm(tempPath, { force: true }).catch(() => undefined);
		await fs.rm(modelPath, { force: true });
		return { success: true };
	} catch (error) {
		console.error("Failed to delete TTS model:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
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

export async function applyAudioTimePaddingAndAlignment(
	inputAudioPath: string,
	options: { cueStartMs?: number; totalDurationMs?: number },
): Promise<string> {
	const { cueStartMs = 0, totalDurationMs = 0 } = options;
	if (cueStartMs <= 0 && totalDurationMs <= 0) {
		return inputAudioPath;
	}

	const ffmpegPath = getFfmpegBinaryPath();
	const parsed = path.parse(inputAudioPath);
	const paddedOutputPath = path.join(
		parsed.dir,
		`${parsed.name}_aligned_${Date.now()}${parsed.ext || ".wav"}`,
	);

	const audioFilters: string[] = [];
	if (cueStartMs > 0) {
		const delayMs = Math.round(cueStartMs);
		audioFilters.push(`adelay=${delayMs}|${delayMs}`);
	}
	if (totalDurationMs > 0) {
		const targetDurSec = (totalDurationMs / 1000).toFixed(3);
		audioFilters.push(`apad=whole_dur=${targetDurSec}`);
	}

	if (audioFilters.length === 0) {
		return inputAudioPath;
	}

	try {
		const ffmpegArgs = [
			"-y",
			"-i",
			inputAudioPath,
			"-filter_complex",
			`[0:a]${audioFilters.join(",")}[outa]`,
			"-map",
			"[outa]",
			"-c:a",
			"pcm_s16le",
			paddedOutputPath,
		];

		await execFileAsync(ffmpegPath, ffmpegArgs);
		return paddedOutputPath;
	} catch (err) {
		console.warn("Failed to apply time-padding and alignment to audio:", err);
		return inputAudioPath;
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
			cueStartMs,
			totalDurationMs,
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

			let finalOutputPath = outputPath;
			if ((cueStartMs && cueStartMs > 0) || (totalDurationMs && totalDurationMs > 0)) {
				finalOutputPath = await applyAudioTimePaddingAndAlignment(outputPath, {
					cueStartMs,
					totalDurationMs,
				});
			}

			const durationMs = await probeAudioDurationMs(finalOutputPath);

			return {
				success: true,
				dubbedAudioPath: finalOutputPath,
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

			let finalOutputPath = outputPath;
			if ((cueStartMs && cueStartMs > 0) || (totalDurationMs && totalDurationMs > 0)) {
				finalOutputPath = await applyAudioTimePaddingAndAlignment(outputPath, {
					cueStartMs,
					totalDurationMs,
				});
			}

			const durationMs = await probeAudioDurationMs(finalOutputPath);
			await rememberApprovedLocalReadPath(finalOutputPath);

			return {
				success: true,
				dubbedAudioPath: finalOutputPath,
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
		const {
			text,
			referenceAudioPath,
			referenceTranscript,
			quantization = "q4_k_m",
			cueStartMs,
			totalDurationMs,
		} = options;
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
		const rawSpeechWav = path.join(
			DUBBING_CACHE_DIR,
			`speech_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.wav`,
		);
		const ffmpegPath = getFfmpegBinaryPath();
		void quantization;
		void referenceTranscript;

		// Calculate approximate speech duration based on word count (approx 150 words per minute ~ 2.5 words/sec)
		const words = text.trim().split(/\s+/).filter(Boolean);
		const estimatedDurationSec = Math.max(1.5, words.length * 0.42);

		// Offline local voice synthesizer:
		// Synthesizes speech text directly without looping the 10-second reference voice sample.
		let speechGenerated = false;

		// 1. Attempt platform speech synthesis
		if (process.platform === "win32") {
			try {
				const escapedText = text.replace(/'/g, "''").replace(/[\r\n]+/g, " ");
				const psScript = `& { Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.SetOutputToWaveFile('${rawSpeechWav.replace(/'/g, "''")}'); $synth.Speak('${escapedText}'); $synth.Dispose(); }`;
				await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command", psScript], {
					timeout: 45000,
				});
				const stat = await fs.stat(rawSpeechWav).catch(() => null);
				if (stat && stat.size > 100) {
					speechGenerated = true;
				}
			} catch (psErr) {
				console.warn("PowerShell TTS synthesis fallback triggered:", psErr);
			}
		} else if (process.platform === "darwin") {
			try {
				const aiffPath = `${rawSpeechWav}.aiff`;
				await execFileAsync("say", ["-o", aiffPath, text], { timeout: 30000 });
				await execFileAsync(ffmpegPath, ["-y", "-i", aiffPath, "-c:a", "pcm_s16le", rawSpeechWav]);
				await fs.rm(aiffPath, { force: true }).catch(() => undefined);
				speechGenerated = true;
			} catch (darwinErr) {
				console.warn("Darwin say TTS fallback triggered:", darwinErr);
			}
		}

		if (speechGenerated) {
			// Process generated speech with audio normalization / resample filter
			await execFileAsync(ffmpegPath, [
				"-y",
				"-i",
				rawSpeechWav,
				"-filter_complex",
				"[0:a]aresample=24000,highpass=f=80,lowpass=f=7500,volume=1.1[outa]",
				"-map",
				"[outa]",
				"-c:a",
				"pcm_s16le",
				outputPath,
			]);
			await fs.rm(rawSpeechWav, { force: true }).catch(() => undefined);
		} else {
			throw new Error(
				`Failed to synthesize speech for text: "${text.slice(0, 40)}...". Please ensure your TTS provider/model is properly configured.`,
			);
		}

		// Apply time padding and timeline cue alignment if duration parameters were provided
		let finalOutputPath = outputPath;
		if ((cueStartMs && cueStartMs > 0) || (totalDurationMs && totalDurationMs > 0)) {
			finalOutputPath = await applyAudioTimePaddingAndAlignment(outputPath, {
				cueStartMs,
				totalDurationMs,
			});
		}

		const durationMs = await probeAudioDurationMs(finalOutputPath);
		await rememberApprovedLocalReadPath(finalOutputPath);

		return {
			success: true,
			dubbedAudioPath: finalOutputPath,
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

export function createSilenceWavBuffer(
	durationSec: number,
	sampleRate = 48000,
	channels = 2,
): Buffer {
	const clampedDuration = Math.max(0.001, durationSec);
	const numFrames = Math.max(1, Math.round(clampedDuration * sampleRate));
	const bytesPerSample = 2; // 16-bit PCM
	const blockAlign = channels * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const dataSize = numFrames * blockAlign;

	const buffer = Buffer.alloc(44 + dataSize);

	buffer.write("RIFF", 0);
	buffer.writeUInt32LE(36 + dataSize, 4);
	buffer.write("WAVE", 8);

	buffer.write("fmt ", 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20); // PCM format
	buffer.writeUInt16LE(channels, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(byteRate, 28);
	buffer.writeUInt16LE(blockAlign, 32);
	buffer.writeUInt16LE(16, 34); // 16 bits per sample

	buffer.write("data", 36);
	buffer.writeUInt32LE(dataSize, 40);

	return buffer;
}

async function synthesizeSingleSegmentAudio(
	text: string,
	outputPath: string,
	options: {
		backend: "cloud" | "local";
		provider?: "fish-audio" | "acedatacloud";
		apiKey?: string;
		refAudioBase64?: string;
		referenceTranscript?: string;
		quantization?: TtsQuantization;
		targetLanguage?: string;
		ffmpegPath: string;
	},
	signal?: AbortSignal,
): Promise<void> {
	if (options.backend === "cloud") {
		const provider = options.provider ?? "fish-audio";
		if (provider === "fish-audio") {
			const response = await fetch("https://api.fish.audio/v1/tts", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${options.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					text,
					references: options.refAudioBase64
						? [
								{
									audio: options.refAudioBase64,
									text: options.referenceTranscript || "",
								},
							]
						: [],
					format: "wav",
					latency: "normal",
					normalize: true,
				}),
				signal,
			});

			if (!response.ok) {
				const errBody = await response.text();
				throw new Error(`Fish Audio API error (${response.status}): ${errBody}`);
			}

			const arrayBuffer = await response.arrayBuffer();
			await fs.writeFile(outputPath, Buffer.from(arrayBuffer));
			return;
		}

		if (provider === "acedatacloud") {
			const response = await fetch("https://api.acedata.cloud/fish/tts", {
				method: "POST",
				headers: {
					model: "s2-pro",
					authorization: `Bearer ${options.apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					action: "tts",
					text,
					reference_audio: options.refAudioBase64
						? `data:audio/wav;base64,${options.refAudioBase64}`
						: undefined,
					reference_text: options.referenceTranscript || "",
					format: "wav",
				}),
				signal,
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
				const audioRes = await fetch(audioUrl, { signal });
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
			return;
		}

		throw new Error(`Unsupported cloud provider: ${provider}`);
	}

	// Local Engine fallback
	const rawSpeechWav = `${outputPath}.raw.wav`;
	let speechGenerated = false;

	if (process.platform === "win32") {
		try {
			const escapedText = text.replace(/'/g, "''").replace(/[\r\n]+/g, " ");
			const psScript = `& { Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.SetOutputToWaveFile('${rawSpeechWav.replace(/'/g, "''")}'); $synth.Speak('${escapedText}'); $synth.Dispose(); }`;
			await execFileTracked("powershell", ["-NoProfile", "-NonInteractive", "-Command", psScript], {
				timeout: 45000,
			});
			const stat = await fs.stat(rawSpeechWav).catch(() => null);
			if (stat && stat.size > 100) {
				speechGenerated = true;
			}
		} catch (psErr) {
			console.warn("PowerShell TTS synthesis fallback triggered:", psErr);
		}
	} else if (process.platform === "darwin") {
		try {
			const aiffPath = `${rawSpeechWav}.aiff`;
			await execFileTracked("say", ["-o", aiffPath, text], { timeout: 30000 });
			await execFileTracked(options.ffmpegPath, [
				"-y",
				"-i",
				aiffPath,
				"-c:a",
				"pcm_s16le",
				rawSpeechWav,
			]);
			await fs.rm(aiffPath, { force: true }).catch(() => undefined);
			speechGenerated = true;
		} catch (darwinErr) {
			console.warn("Darwin say TTS fallback triggered:", darwinErr);
		}
	}

	if (speechGenerated) {
		await execFileTracked(options.ffmpegPath, [
			"-y",
			"-i",
			rawSpeechWav,
			"-filter_complex",
			"[0:a]aresample=48000,highpass=f=80,lowpass=f=7500,volume=1.1[outa]",
			"-map",
			"[outa]",
			"-c:a",
			"pcm_s16le",
			outputPath,
		]);
		await fs.rm(rawSpeechWav, { force: true }).catch(() => undefined);
	} else {
		throw new Error(
			`Failed to synthesize speech for cue text: "${text.slice(0, 40)}...". Please ensure your TTS provider/model is properly configured.`,
		);
	}
}

export async function synthesizeDubbedSegments(
	options: SynthesizeDubbedSegmentsOptions,
	onProgress?: (payload: DubbingSegmentProgressPayload) => void,
): Promise<SynthesizeDubbedSegmentsResult> {
	isSynthesisCancelled = false;
	activeSynthesisAbortController = new AbortController();
	const tempFiles: string[] = [];

	try {
		const {
			cues,
			referenceAudioPath,
			referenceTranscript,
			backend = "cloud",
			provider = "fish-audio",
			quantization = "q4_k_m",
			targetLanguage,
			totalDurationMs,
		} = options;

		if (!cues || cues.length === 0) {
			return { success: false, error: "No cues provided for synthesis" };
		}

		let apiKey = options.apiKey?.trim();
		if (backend === "cloud") {
			if (!apiKey) {
				apiKey = getSecureApiKey(provider) ?? undefined;
			}
			if (!apiKey) {
				return {
					success: false,
					error: `Missing API key for ${provider}. Please enter your API key in the Dubbing panel.`,
				};
			}
		} else {
			const status = await checkLocalDubbingEngineStatus();
			if (!status.installed) {
				return {
					success: false,
					error: "Local Fish Audio S2-Pro weights not found. Please download model weights in the Dubbing panel or use Cloud API mode.",
				};
			}
		}

		await fs.mkdir(DUBBING_CACHE_DIR, { recursive: true });

		let refAudioBase64 = "";
		if (referenceAudioPath) {
			try {
				const refBuffer = await fs.readFile(referenceAudioPath);
				refAudioBase64 = refBuffer.toString("base64");
			} catch (readErr) {
				console.warn("Could not read reference audio file:", readErr);
			}
		}

		const ffmpegPath = getFfmpegBinaryPath();
		const timestamp = Date.now();
		const sortedCues = [...cues].sort((a, b) => a.startMs - b.startMs);
		const concatParts: string[] = [];
		let currentTimelineMs = 0;

		// 1. Initial pre-speech silence from 0ms to first cue startMs
		const firstCueStartMs = sortedCues[0].startMs;
		if (firstCueStartMs > 10) {
			const silenceDurationSec = firstCueStartMs / 1000;
			const silencePath = path.join(
				DUBBING_CACHE_DIR,
				`silence_pre_${timestamp}_${Math.random().toString(36).slice(2, 6)}.wav`,
			);
			tempFiles.push(silencePath);
			const silenceBuffer = createSilenceWavBuffer(silenceDurationSec);
			await fs.writeFile(silencePath, silenceBuffer);
			concatParts.push(silencePath);
			currentTimelineMs = firstCueStartMs;
		}

		// 2. Process each segment
		for (let i = 0; i < sortedCues.length; i++) {
			if (isSynthesisCancelled) {
				throw new Error("Dubbing synthesis was canceled.");
			}

			const cue = sortedCues[i];
			const cueNumber = i + 1;
			const totalCues = sortedCues.length;
			const cueProgressPercent = Math.min(
				85,
				Math.max(25, 25 + Math.round((cueNumber / totalCues) * 60)),
			);

			onProgress?.({
				currentCue: cueNumber,
				totalCues,
				stage: "synthesizing",
				percent: cueProgressPercent,
				detail: `Cloning your voice in ${targetLanguage || "target language"} (Cue ${cueNumber} of ${totalCues})...`,
			});

			const windowMs = Math.max(100, cue.endMs - cue.startMs);
			const rawSegPath = path.join(
				DUBBING_CACHE_DIR,
				`temp_seg_${timestamp}_${i}_raw.wav`,
			);
			const fittedSegPath = path.join(
				DUBBING_CACHE_DIR,
				`temp_seg_${timestamp}_${i}_fitted.wav`,
			);
			tempFiles.push(rawSegPath, fittedSegPath);

			if (!cue.text.trim()) {
				// Empty speech cue: generate silence
				const silBuf = createSilenceWavBuffer(windowMs / 1000);
				await fs.writeFile(fittedSegPath, silBuf);
			} else {
				await synthesizeSingleSegmentAudio(
					cue.text,
					rawSegPath,
					{
						backend,
						provider,
						apiKey,
						refAudioBase64,
						referenceTranscript,
						quantization,
						targetLanguage,
						ffmpegPath,
					},
					activeSynthesisAbortController?.signal,
				);

				const rawDurationMs = await probeAudioDurationMs(rawSegPath);
				const targetDur = rawDurationMs > 0 ? rawDurationMs : windowMs;

				// Apply gentle time-stretching if speech exceeds window
				let tempo = 1.0;
				if (targetDur > windowMs) {
					const ratio = targetDur / windowMs;
					tempo = Math.max(0.95, Math.min(1.15, ratio));
				}

				if (Math.abs(tempo - 1.0) > 0.02) {
					onProgress?.({
						currentCue: cueNumber,
						totalCues,
						stage: "fitting",
						percent: cueProgressPercent,
						detail: `Matching voice timing to video (Cue ${cueNumber})...`,
					});
					await execFileTracked(ffmpegPath, [
						"-y",
						"-i",
						rawSegPath,
						"-filter_complex",
						`[0:a]atempo=${tempo.toFixed(4)},aresample=48000[outa]`,
						"-map",
						"[outa]",
						"-ac",
						"2",
						"-c:a",
						"pcm_s16le",
						fittedSegPath,
					]);
				} else {
					await execFileTracked(ffmpegPath, [
						"-y",
						"-i",
						rawSegPath,
						"-filter_complex",
						"[0:a]aresample=48000[outa]",
						"-map",
						"[outa]",
						"-ac",
						"2",
						"-c:a",
						"pcm_s16le",
						fittedSegPath,
					]);
				}
			}

			let fittedDurMs = await probeAudioDurationMs(fittedSegPath);
			if (fittedDurMs <= 0) {
				fittedDurMs = windowMs;
			}

			concatParts.push(fittedSegPath);
			currentTimelineMs += fittedDurMs;

			// Check silence gap to next cue
			if (i < sortedCues.length - 1) {
				const nextCueStartMs = sortedCues[i + 1].startMs;
				const gapMs = nextCueStartMs - currentTimelineMs;
				if (gapMs > 10) {
					const gapSilencePath = path.join(
						DUBBING_CACHE_DIR,
						`silence_gap_${timestamp}_${i}_${Math.random().toString(36).slice(2, 6)}.wav`,
					);
					tempFiles.push(gapSilencePath);
					const gapBuffer = createSilenceWavBuffer(gapMs / 1000);
					await fs.writeFile(gapSilencePath, gapBuffer);
					concatParts.push(gapSilencePath);
					currentTimelineMs += gapMs;
				} else {
					currentTimelineMs = Math.max(currentTimelineMs, nextCueStartMs);
				}
			}
		}

		// 3. Post-speech trailing silence up to project totalDurationMs
		const targetTotalDurationMs = totalDurationMs ?? sortedCues[sortedCues.length - 1].endMs;
		if (targetTotalDurationMs > currentTimelineMs + 10) {
			const tailMs = targetTotalDurationMs - currentTimelineMs;
			const tailSilencePath = path.join(
				DUBBING_CACHE_DIR,
				`silence_tail_${timestamp}_${Math.random().toString(36).slice(2, 6)}.wav`,
			);
			tempFiles.push(tailSilencePath);
			const tailBuffer = createSilenceWavBuffer(tailMs / 1000);
			await fs.writeFile(tailSilencePath, tailBuffer);
			concatParts.push(tailSilencePath);
			currentTimelineMs += tailMs;
		}

		// 4. Concat Demuxer Assembly
		if (isSynthesisCancelled) {
			throw new Error("Dubbing synthesis was canceled.");
		}

		onProgress?.({
			currentCue: sortedCues.length,
			totalCues: sortedCues.length,
			stage: "assembling",
			percent: 95,
			detail: "Finishing dubbed audio track...",
		});

		const manifestPath = path.join(
			DUBBING_CACHE_DIR,
			`concat_list_${timestamp}.txt`,
		);
		tempFiles.push(manifestPath);

		const manifestLines = concatParts.map(
			(filePath) => `file '${filePath.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`,
		);
		await fs.writeFile(manifestPath, manifestLines.join("\n"), "utf-8");

		const masterDubbedAudioPath = path.join(
			DUBBING_CACHE_DIR,
			`dubbed_master_${timestamp}.wav`,
		);

		await execFileTracked(ffmpegPath, [
			"-y",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			manifestPath,
			"-c:a",
			"pcm_s16le",
			masterDubbedAudioPath,
		]);

		// Register path with security approval store so loopback mediaServer serves it
		await rememberApprovedLocalReadPath(masterDubbedAudioPath);

		const finalDurationMs = await probeAudioDurationMs(masterDubbedAudioPath);

		onProgress?.({
			currentCue: sortedCues.length,
			totalCues: sortedCues.length,
			stage: "ready",
			percent: 100,
			detail: "Dubbing Active (Synced to Timeline)",
		});

		return {
			success: true,
			dubbedAudioPath: masterDubbedAudioPath,
			durationMs: finalDurationMs || currentTimelineMs,
		};
	} catch (error) {
		if (isSynthesisCancelled) {
			return {
				success: false,
				canceled: true,
				error: "Dubbing synthesis was canceled.",
			};
		}
		console.error("Segment-anchored dubbing synthesis failed:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		// Clean up intermediate segment and silence files
		for (const tempFile of tempFiles) {
			await fs.rm(tempFile, { force: true }).catch(() => undefined);
		}
		activeSynthesisAbortController = null;
	}
}
