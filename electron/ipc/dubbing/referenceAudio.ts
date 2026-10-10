import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { dialog } from "electron";
import { resolveCaptionAudioCandidates, transcribeAudioFile } from "../captions/generate";
import { DUBBING_CACHE_DIR } from "../constants";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { hasEmbeddedAudioStream } from "../recording/diagnostics";
import { normalizeVideoSourcePath } from "../utils";
import { probeAudioDurationMs } from "./fishAudio";
import type {
	ExtractVoiceReferenceOptions,
	ExtractVoiceReferenceResult,
	ImportVoiceReferenceFileOptions,
	SaveLiveVoiceReferenceOptions,
	TranscribeAudioSampleOptions,
	TranscribeAudioSampleResult,
} from "./types";

const execFileAsync = promisify(execFile);

const MIC_SIDECAR_EXTENSIONS = [".mic.wav", ".mic.m4a", ".mic.webm", "-mic.wav", "_mic.wav"];

async function findCompanionMicTrack(normalizedVideoPath: string): Promise<string | null> {
	const basePath = normalizedVideoPath.replace(/\.[^.]+$/u, "");
	for (const ext of MIC_SIDECAR_EXTENSIONS) {
		const candidate = `${basePath}${ext}`;
		try {
			const stat = await fs.stat(candidate);
			if (stat.size > 0) {
				return candidate;
			}
		} catch {
			// Expected if not present
		}
	}
	return null;
}

export async function extractVoiceReferenceSample(
	options: ExtractVoiceReferenceOptions,
): Promise<ExtractVoiceReferenceResult> {
	try {
		const rawVideoPath = options.videoPath ? normalizeVideoSourcePath(options.videoPath) ?? options.videoPath : undefined;
		const rawAudioPath = options.audioPath ? normalizeVideoSourcePath(options.audioPath) ?? options.audioPath : undefined;
		const { existingCues = [] } = options;

		if (!rawVideoPath && !rawAudioPath) {
			return { success: false, error: "No video or audio path provided" };
		}

		await fs.mkdir(DUBBING_CACHE_DIR, { recursive: true });

		// 1. Resolve source audio path
		let sourceAudioPath: string | null = null;

		if (rawAudioPath) {
			try {
				const stat = await fs.stat(rawAudioPath);
				if (stat.size > 0) {
					sourceAudioPath = rawAudioPath;
				}
			} catch {
				// Fall back to video resolution
			}
		}

		if (!sourceAudioPath && rawVideoPath) {
			// Proactively check for companion microphone track alongside video
			sourceAudioPath = await findCompanionMicTrack(rawVideoPath);

			if (!sourceAudioPath) {
				const candidates = await resolveCaptionAudioCandidates(rawVideoPath);
				const selectedAudio =
					candidates.find((c) => c.label.includes("microphone")) ??
					candidates.find((c) => c.label === "recording") ??
					candidates[0];

				if (selectedAudio) {
					sourceAudioPath = selectedAudio.path;
				}
			}
		}

		if (!sourceAudioPath && rawVideoPath) {
			sourceAudioPath = rawVideoPath;
		}

		if (!sourceAudioPath) {
			return { success: false, error: "Could not locate audio source for voice sample extraction." };
		}

		// 2. Verify that sourceAudioPath actually has an audio stream
		const isVideoContainer = /\.(mp4|mov|mkv|avi|webm|flv|wmv)$/i.test(sourceAudioPath);
		if (isVideoContainer) {
			const hasAudio = await hasEmbeddedAudioStream(sourceAudioPath);
			if (!hasAudio) {
				return {
					success: false,
					error: "The selected recording does not contain an audio or microphone track.",
				};
			}
		}

		// 3. Determine start and duration
		let targetStartMs = options.startMs;
		let targetDurationMs = options.durationMs;
		let suggestedTranscript = "";

		if (targetStartMs === undefined || targetDurationMs === undefined) {
			if (existingCues.length > 0) {
				// Search for a cluster of cues totaling ~5 to 8 seconds
				let foundMatch = false;

				for (let i = 0; i < existingCues.length; i++) {
					const start = existingCues[i].startMs;
					let combinedText = existingCues[i].text.trim();

					for (let j = i; j < existingCues.length; j++) {
						const dur = existingCues[j].endMs - start;
						if (j > i) {
							combinedText += ` ${existingCues[j].text.trim()}`;
						}

						if (dur >= 4500 && dur <= 9500) {
							targetStartMs = start;
							targetDurationMs = dur;
							suggestedTranscript = combinedText;
							foundMatch = true;
							break;
						}
					}
					if (foundMatch) break;
				}

				// If no exact match found, take the first cue or first 2 cues
				if (!foundMatch && existingCues.length > 0) {
					targetStartMs = existingCues[0].startMs;
					const endMs = existingCues[Math.min(2, existingCues.length - 1)].endMs;
					targetDurationMs = Math.min(8000, Math.max(3000, endMs - targetStartMs));
					suggestedTranscript = existingCues
						.slice(0, Math.min(3, existingCues.length))
						.map((c) => c.text.trim())
						.join(" ");
				}
			} else {
				targetStartMs = 1000;
				targetDurationMs = 6000;
				suggestedTranscript = "";
			}
		}

		const safeStartMs = Math.max(0, targetStartMs ?? 1000);
		const safeDurationMs = Math.min(10000, Math.max(3000, targetDurationMs ?? 6000));
		const startSec = (safeStartMs / 1000).toFixed(3);
		const durationSec = (safeDurationMs / 1000).toFixed(3);

		// If start/duration were explicitly provided, match overlapping cues to populate transcript
		if (!suggestedTranscript && existingCues.length > 0) {
			const overlappingCues = existingCues.filter(
				(cue) => cue.endMs > safeStartMs && cue.startMs < safeStartMs + safeDurationMs,
			);
			if (overlappingCues.length > 0) {
				suggestedTranscript = overlappingCues.map((c) => c.text.trim()).join(" ");
			}
		}

		const filename = `voice_ref_slice_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.wav`;
		const outputPath = path.join(DUBBING_CACHE_DIR, filename);
		const ffmpegPath = getFfmpegBinaryPath();

		// Slices a 16kHz mono WAV for high-fidelity zero-shot TTS cloning
		await execFileAsync(ffmpegPath, [
			"-y",
			"-ss",
			startSec,
			"-t",
			durationSec,
			"-i",
			sourceAudioPath,
			"-vn",
			"-ac",
			"1",
			"-ar",
			"16000",
			"-c:a",
			"pcm_s16le",
			outputPath,
		]);

		return {
			success: true,
			referenceAudioPath: outputPath,
			durationMs: safeDurationMs,
			suggestedTranscript: suggestedTranscript.trim(),
			sourceType: "timeline",
		};
	} catch (error) {
		console.error("Failed to extract voice reference sample:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function importVoiceReferenceFile(
	options: ImportVoiceReferenceFileOptions,
): Promise<ExtractVoiceReferenceResult> {
	try {
		await fs.mkdir(DUBBING_CACHE_DIR, { recursive: true });

		let targetFilePath = options.filePath?.trim();

		if (!targetFilePath) {
			const dialogResult = await dialog.showOpenDialog({
				title: "Select Voice Reference Audio",
				filters: [
					{
						name: "Audio Files",
						extensions: ["wav", "mp3", "m4a", "ogg", "flac", "webm", "aac"],
					},
					{ name: "All Files", extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
				return { success: false, canceled: true };
			}
			targetFilePath = dialogResult.filePaths[0];
		}

		const normalizedInputPath = normalizeVideoSourcePath(targetFilePath) ?? targetFilePath;
		await fs.access(normalizedInputPath);

		// Probe audio duration
		const inputDurationMs = await probeAudioDurationMs(normalizedInputPath);

		const filename = `voice_ref_upload_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.wav`;
		const outputPath = path.join(DUBBING_CACHE_DIR, filename);
		const ffmpegPath = getFfmpegBinaryPath();

		// If input is longer than 15s, trim to first 12 seconds for zero-shot voice cloning
		const shouldTrim = inputDurationMs > 15000;
		const ffmpegArgs = [
			"-y",
			"-i",
			normalizedInputPath,
			...(shouldTrim ? ["-t", "12.000"] : []),
			"-vn",
			"-ac",
			"1",
			"-ar",
			"16000",
			"-c:a",
			"pcm_s16le",
			outputPath,
		];

		await execFileAsync(ffmpegPath, ffmpegArgs);

		const finalDurationMs = await probeAudioDurationMs(outputPath);

		// Attempt auto-transcription with Whisper
		let suggestedTranscript = "";
		try {
			suggestedTranscript = await transcribeAudioFile({
				audioPath: outputPath,
				whisperExecutablePath: options.whisperExecutablePath,
				whisperModelPath: options.whisperModelPath,
			});
		} catch (transcribeError) {
			console.warn("[dubbing] Auto-transcription of uploaded voice sample skipped:", transcribeError);
		}

		return {
			success: true,
			referenceAudioPath: outputPath,
			durationMs: finalDurationMs || (shouldTrim ? 12000 : inputDurationMs),
			suggestedTranscript: suggestedTranscript.trim(),
			sourceType: "upload",
		};
	} catch (error) {
		console.error("Failed to import voice reference file:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function saveLiveVoiceReference(
	options: SaveLiveVoiceReferenceOptions,
): Promise<ExtractVoiceReferenceResult> {
	try {
		await fs.mkdir(DUBBING_CACHE_DIR, { recursive: true });

		let buffer: Buffer;
		if (options.audioBuffer instanceof Uint8Array) {
			buffer = Buffer.from(options.audioBuffer);
		} else if (options.audioBuffer instanceof ArrayBuffer) {
			buffer = Buffer.from(options.audioBuffer);
		} else if (Array.isArray(options.audioBuffer)) {
			buffer = Buffer.from(options.audioBuffer);
		} else if (typeof options.audioBuffer === "string") {
			buffer = Buffer.from(options.audioBuffer, "base64");
		} else {
			return { success: false, error: "Invalid audio buffer provided" };
		}

		if (buffer.length === 0) {
			return { success: false, error: "Empty audio recording buffer" };
		}

		const tempExt = options.mimeType?.includes("webm") ? "webm" : "wav";
		const tempInputPath = path.join(
			DUBBING_CACHE_DIR,
			`live_rec_temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${tempExt}`,
		);
		await fs.writeFile(tempInputPath, buffer);

		const filename = `voice_ref_record_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.wav`;
		const outputPath = path.join(DUBBING_CACHE_DIR, filename);
		const ffmpegPath = getFfmpegBinaryPath();

		try {
			await execFileAsync(ffmpegPath, [
				"-y",
				"-i",
				tempInputPath,
				"-vn",
				"-ac",
				"1",
				"-ar",
				"16000",
				"-c:a",
				"pcm_s16le",
				outputPath,
			]);
		} finally {
			await fs.rm(tempInputPath, { force: true });
		}

		const durationMs = await probeAudioDurationMs(outputPath);

		// Attempt auto-transcription with Whisper
		let suggestedTranscript = "";
		try {
			suggestedTranscript = await transcribeAudioFile({
				audioPath: outputPath,
				whisperExecutablePath: options.whisperExecutablePath,
				whisperModelPath: options.whisperModelPath,
			});
		} catch (transcribeError) {
			console.warn("[dubbing] Auto-transcription of live voice recording skipped:", transcribeError);
		}

		if (!suggestedTranscript && options.promptText) {
			suggestedTranscript = options.promptText.trim();
		}

		return {
			success: true,
			referenceAudioPath: outputPath,
			durationMs: durationMs || 8000,
			suggestedTranscript: suggestedTranscript.trim(),
			sourceType: "record",
		};
	} catch (error) {
		console.error("Failed to save live voice reference:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function transcribeVoiceReferenceSample(
	options: TranscribeAudioSampleOptions,
): Promise<TranscribeAudioSampleResult> {
	try {
		if (!options.audioPath) {
			return { success: false, error: "No audio path provided" };
		}
		const transcript = await transcribeAudioFile(options);
		return {
			success: true,
			transcript,
		};
	} catch (error) {
		console.error("Failed to transcribe voice reference sample:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
