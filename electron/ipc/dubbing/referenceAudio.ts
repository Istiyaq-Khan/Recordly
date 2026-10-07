import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveCaptionAudioCandidates } from "../captions/generate";
import { DUBBING_CACHE_DIR } from "../constants";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import type { ExtractVoiceReferenceOptions, ExtractVoiceReferenceResult } from "./types";

const execFileAsync = promisify(execFile);

export async function extractVoiceReferenceSample(
	options: ExtractVoiceReferenceOptions,
): Promise<ExtractVoiceReferenceResult> {
	try {
		const { videoPath, existingCues = [] } = options;
		if (!videoPath) {
			return { success: false, error: "No video path provided" };
		}

		await fs.mkdir(DUBBING_CACHE_DIR, { recursive: true });

		// 1. Resolve audio candidates (prefer microphone sidecar)
		const candidates = await resolveCaptionAudioCandidates(videoPath);
		const selectedAudio =
			candidates.find((c) => c.label.includes("microphone")) ??
			candidates.find((c) => c.label === "recording") ??
			candidates[0];

		const sourceAudioPath = selectedAudio ? selectedAudio.path : videoPath;

		// 2. Determine start and duration
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

		const filename = `voice_ref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.wav`;
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
		};
	} catch (error) {
		console.error("Failed to extract voice reference sample:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
