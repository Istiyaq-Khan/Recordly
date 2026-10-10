import { beforeEach, describe, expect, it, vi } from "vitest";

const execArgs: string[][] = [];

vi.mock("node:child_process", () => ({
	execFile: vi.fn((_bin, args, callback) => {
		execArgs.push(args);
		callback(null, { stdout: "", stderr: "" });
	}),
}));

vi.mock("electron", () => ({
	app: {
		getPath: () => "/tmp/recordly-test",
	},
	dialog: {
		showOpenDialog: vi.fn().mockResolvedValue({
			canceled: false,
			filePaths: ["/recordings/sample.mp3"],
		}),
	},
}));

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	const mockAccess = vi.fn().mockResolvedValue(undefined);
	const mockMkdir = vi.fn().mockResolvedValue(undefined);
	const mockWriteFile = vi.fn().mockResolvedValue(undefined);
	const mockRm = vi.fn().mockResolvedValue(undefined);
	const mockStat = vi.fn().mockImplementation(async (filePath: string) => {
		if (typeof filePath === "string" && filePath.includes("no-audio")) {
			if (filePath.endsWith("no-audio.mp4")) {
				return { size: 102400 };
			}
			throw new Error("File not found");
		}
		if (
			typeof filePath === "string" &&
			(filePath.includes("mic.wav") || filePath.includes("sample.mp3") || filePath.includes("video.mp4"))
		) {
			return { size: 102400 };
		}
		throw new Error("File not found");
	});

	const mocks = {
		mkdir: mockMkdir,
		access: mockAccess,
		stat: mockStat,
		writeFile: mockWriteFile,
		rm: mockRm,
	};

	return {
		...actual,
		...mocks,
		default: {
			...(actual.default || actual),
			...mocks,
		},
	};
});

vi.mock("../captions/generate", () => ({
	resolveCaptionAudioCandidates: vi.fn().mockImplementation(async (videoPath: string) => {
		if (typeof videoPath === "string" && videoPath.includes("no-audio")) {
			return [{ label: "recording", path: videoPath }];
		}
		return [{ label: "microphone track", path: "/recordings/video.mic.wav" }];
	}),
	transcribeAudioFile: vi.fn().mockResolvedValue("Transcribed speech sample"),
}));

vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => "/mock/ffmpeg",
}));

vi.mock("../recording/diagnostics", () => ({
	hasEmbeddedAudioStream: vi.fn().mockImplementation(async (filePath: string) => {
		return !filePath.includes("no-audio");
	}),
}));

vi.mock("./fishAudio", () => ({
	probeAudioDurationMs: vi.fn().mockResolvedValue(6500),
}));

import {
	extractVoiceReferenceSample,
	importVoiceReferenceFile,
	saveLiveVoiceReference,
	transcribeVoiceReferenceSample,
} from "./referenceAudio";

describe("Voice Reference Audio Extraction & Multi-Source System", () => {
	beforeEach(() => {
		execArgs.length = 0;
		vi.clearAllMocks();
	});

	it("fails gracefully when videoPath and audioPath are empty", async () => {
		const result = await extractVoiceReferenceSample({
			videoPath: "",
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("No video or audio path provided");
	});

	it("fails gracefully when video container has no audio stream and no companion mic track", async () => {
		const result = await extractVoiceReferenceSample({
			videoPath: "/recordings/no-audio.mp4",
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("does not contain an audio or microphone track");
	});

	it("extracts optimal 5-8s reference sample using existing cues from companion mic track", async () => {
		const cues = [
			{ id: "1", startMs: 1000, endMs: 3500, text: "Hello everyone" },
			{ id: "2", startMs: 3500, endMs: 7000, text: "and welcome back to my channel" },
		];

		const result = await extractVoiceReferenceSample({
			videoPath: "/recordings/video.mp4",
			existingCues: cues,
		});

		expect(result.success).toBe(true);
		expect(result.referenceAudioPath).toBeDefined();
		expect(result.suggestedTranscript).toBe("Hello everyone and welcome back to my channel");
		expect(result.durationMs).toBe(6000);
		expect(result.sourceType).toBe("timeline");

		expect(execArgs.length).toBe(1);
		const args = execArgs[0];
		// Verifies 16kHz mono PCM WAV extraction
		expect(args).toContain("16000");
		expect(args).toContain("pcm_s16le");
		expect(args).toContain("/recordings/video.mic.wav");
	});

	it("imports external audio file and returns 16kHz WAV with transcript", async () => {
		const result = await importVoiceReferenceFile({
			filePath: "/recordings/sample.mp3",
		});

		expect(result.success).toBe(true);
		expect(result.referenceAudioPath).toBeDefined();
		expect(result.suggestedTranscript).toBe("Transcribed speech sample");
		expect(result.sourceType).toBe("upload");
		expect(result.durationMs).toBe(6500);

		expect(execArgs.length).toBe(1);
		const args = execArgs[0];
		expect(args).toContain("/recordings/sample.mp3");
		expect(args).toContain("16000");
	});

	it("saves live recorded audio buffer and generates 16kHz WAV reference", async () => {
		const dummyBuffer = new Uint8Array([1, 2, 3, 4, 5]);
		const result = await saveLiveVoiceReference({
			audioBuffer: dummyBuffer,
			mimeType: "audio/webm",
			promptText: "Fallback prompt text",
		});

		expect(result.success).toBe(true);
		expect(result.referenceAudioPath).toBeDefined();
		expect(result.suggestedTranscript).toBe("Transcribed speech sample");
		expect(result.sourceType).toBe("record");

		expect(execArgs.length).toBe(1);
		const args = execArgs[0];
		expect(args).toContain("16000");
		expect(args).toContain("pcm_s16le");
	});

	it("transcribes audio sample on demand", async () => {
		const result = await transcribeVoiceReferenceSample({
			audioPath: "/cache/voice_ref.wav",
		});

		expect(result.success).toBe(true);
		expect(result.transcript).toBe("Transcribed speech sample");
	});
});
