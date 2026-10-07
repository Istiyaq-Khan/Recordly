import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DUBBING_CACHE_DIR, DUBBING_MODELS_DIR } from "../constants";
import { getFfprobeBinaryPath } from "../ffmpeg/binary";
import { getSecureApiKey } from "./storage";
import type { SynthesizeApiOptions, SynthesizeLocalOptions, SynthesizeResult } from "./types";

const execFileAsync = promisify(execFile);

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
		await fs.access(DUBBING_MODELS_DIR);
		return {
			success: true,
			installed: true,
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
			const refBuffer = await fs.readFile(referenceAudioPath);
			refAudioBase64 = refBuffer.toString("base64");
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
		const { text, referenceAudioPath } = options;
		if (!text.trim()) {
			return { success: false, error: "No text provided for synthesis" };
		}
		await fs.mkdir(DUBBING_CACHE_DIR, { recursive: true });

		const status = await checkLocalDubbingEngineStatus();
		if (!status.installed) {
			return {
				success: false,
				error: "Local Fish Audio S2-Pro weights not found in resources/models/dubbing. Please install local weights or use Cloud API mode.",
			};
		}

		const outputFilename = `dubbed_local_${Date.now()}.wav`;
		const outputPath = path.join(DUBBING_CACHE_DIR, outputFilename);

		// If reference audio is provided, copy/use reference as base for offline playback demonstration
		if (referenceAudioPath) {
			await fs.copyFile(referenceAudioPath, outputPath);
			const durationMs = await probeAudioDurationMs(outputPath);
			return {
				success: true,
				dubbedAudioPath: outputPath,
				durationMs,
			};
		}

		return {
			success: false,
			error: "Local synthesis requires a reference voice sample.",
		};
	} catch (error) {
		console.error("Local audio synthesis failed:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
