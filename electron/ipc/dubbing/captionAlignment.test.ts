import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../captions/generate", () => ({
	generateAutoCaptionsFromVideo: vi.fn(),
}));

vi.mock("../captions/whisper", () => ({
	getWhisperSmallModelStatus: vi.fn(),
}));

import { generateAutoCaptionsFromVideo } from "../captions/generate";
import { getWhisperSmallModelStatus } from "../captions/whisper";
import { alignDubbedCaptions } from "./captionAlignment";

describe("Caption Alignment on Synthesized Audio", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns error if no whisper model path is available or found", async () => {
		vi.mocked(getWhisperSmallModelStatus).mockResolvedValue({
			exists: false,
			path: null,
		} as never);

		const result = await alignDubbedCaptions({
			dubbedAudioPath: "/out/dubbed.wav",
			targetLanguage: "es",
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain("No Whisper model available");
	});

	it("aligns captions using provided whisperModelPath and generated cues", async () => {
		vi.mocked(generateAutoCaptionsFromVideo).mockResolvedValue({
			success: true,
			cues: [
				{ id: "c1", startMs: 0, endMs: 1500, text: "Hola" },
				{ id: "c2", startMs: 1500, endMs: 3000, text: "mundo" },
			],
		} as never);

		const result = await alignDubbedCaptions({
			dubbedAudioPath: "/out/dubbed.wav",
			targetLanguage: "es",
			whisperModelPath: "/models/ggml-small.bin",
		});

		expect(result.success).toBe(true);
		expect(result.cues).toHaveLength(2);
		expect(result.cues?.[0].text).toBe("Hola");
		expect(generateAutoCaptionsFromVideo).toHaveBeenCalledWith(
			expect.objectContaining({
				videoPath: "/out/dubbed.wav",
				whisperModelPath: "/models/ggml-small.bin",
				language: "es",
			}),
		);
	});
});
