import { generateAutoCaptionsFromVideo } from "../captions/generate";
import { getWhisperSmallModelStatus } from "../captions/whisper";
import type { AlignCaptionsOptions, AlignCaptionsResult } from "./types";

export async function alignDubbedCaptions(
	options: AlignCaptionsOptions,
): Promise<AlignCaptionsResult> {
	try {
		const { dubbedAudioPath, targetLanguage, whisperExecutablePath } = options;
		let whisperModelPath = options.whisperModelPath;

		if (!whisperModelPath) {
			const status = await getWhisperSmallModelStatus();
			if (status.exists && status.path) {
				whisperModelPath = status.path;
			}
		}

		if (!whisperModelPath) {
			return {
				success: false,
				error: "No Whisper model available. Please download the Whisper model to align captions.",
			};
		}

		const result = await generateAutoCaptionsFromVideo({
			videoPath: dubbedAudioPath,
			whisperExecutablePath,
			whisperModelPath,
			language: targetLanguage,
		});

		return {
			success: true,
			cues: result.cues,
		};
	} catch (error) {
		console.error("Failed to re-align captions for dubbed audio:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
