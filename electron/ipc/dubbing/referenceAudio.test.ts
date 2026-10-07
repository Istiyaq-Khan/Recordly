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
}));

vi.mock("../captions/generate", () => ({
	resolveCaptionAudioCandidates: vi
		.fn()
		.mockResolvedValue([{ label: "microphone track", path: "/tmp/mic.wav" }]),
}));

vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => "/mock/ffmpeg",
}));

import { extractVoiceReferenceSample } from "./referenceAudio";

describe("Voice Reference Audio Extraction", () => {
	beforeEach(() => {
		execArgs.length = 0;
		vi.clearAllMocks();
	});

	it("fails gracefully when videoPath is empty", async () => {
		const result = await extractVoiceReferenceSample({
			videoPath: "",
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("No video path provided");
	});

	it("extracts optimal 5-8s reference sample using existing cues", async () => {
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

		expect(execArgs.length).toBe(1);
		const args = execArgs[0];
		// Verifies 16kHz mono PCM WAV extraction
		expect(args).toContain("16000");
		expect(args).toContain("pcm_s16le");
		expect(args).toContain("/tmp/mic.wav");
	});
});
