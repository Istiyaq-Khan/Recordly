import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: () => "/tmp/recordly-test",
	},
}));

vi.mock("../ffmpeg/binary", () => ({
	getFfprobeBinaryPath: () => "/mock/ffprobe",
}));

vi.mock("./storage", () => ({
	getSecureApiKey: vi.fn(),
	saveSecureApiKey: vi.fn(),
}));

import {
	cancelDubbingSynthesis,
	cancelTtsModelDownload,
	checkLocalDubbingEngineStatus,
	createSilenceWavBuffer,
	deleteTtsModel,
	FISH_TTS_MODEL_CONFIGS,
	FISH_TTS_TOKENIZER_CONFIG,
	getTtsModelPath,
	getTtsModelStatus,
	synthesizeAudioWithApi,
	synthesizeAudioWithLocalEngine,
	synthesizeDubbedSegments,
} from "./fishAudio";
import { getSecureApiKey } from "./storage";

describe("Fish Audio S2-Pro Engine", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.resetAllMocks();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("defines valid rodrigomt/s2-pro-gguf Hugging Face configs for all quantization levels and full model", () => {
		expect(FISH_TTS_MODEL_CONFIGS.q4_k_m.url).toContain("rodrigomt/s2-pro-gguf");
		expect(FISH_TTS_MODEL_CONFIGS.q5_k_m.url).toContain("rodrigomt/s2-pro-gguf");
		expect(FISH_TTS_MODEL_CONFIGS.q6_k.url).toContain("rodrigomt/s2-pro-gguf");
		expect(FISH_TTS_MODEL_CONFIGS.q8_0.url).toContain("rodrigomt/s2-pro-gguf");
		expect(FISH_TTS_MODEL_CONFIGS.f16.url).toContain("rodrigomt/s2-pro-gguf");

		expect(getTtsModelPath("q4_k_m")).toContain("s2-pro-q4_k_m.gguf");
		expect(getTtsModelPath("q5_k_m")).toContain("s2-pro-q5_k_m.gguf");
		expect(getTtsModelPath("q6_k")).toContain("s2-pro-q6_k.gguf");
		expect(getTtsModelPath("q8_0")).toContain("s2-pro-q8_0.gguf");
		expect(getTtsModelPath("f16")).toContain("s2-pro-f16.gguf");

		expect(FISH_TTS_TOKENIZER_CONFIG.url).toContain("rodrigomt/s2-pro-gguf/resolve/main/tokenizer.json");
		expect(FISH_TTS_TOKENIZER_CONFIG.filename).toBe("tokenizer.json");
	});

	it("handles cancellation cleanly when no download is active", async () => {
		const res = await cancelTtsModelDownload();
		expect(res.success).toBe(true);
		expect(res.canceled).toBe(false);
	});

	it("handles model deletion safely", async () => {
		const res = await deleteTtsModel("q5_k_m");
		expect(res.success).toBe(true);
	});

	it("returns model status indicating existence state", async () => {
		const status = await getTtsModelStatus("q4_k_m");
		expect(status.success).toBe(true);
		expect(status.quantization).toBe("q4_k_m");
		expect(typeof status.exists).toBe("boolean");
	});

	it("checks local engine installation status", async () => {
		const status = await checkLocalDubbingEngineStatus();
		expect(status.success).toBe(true);
		expect(typeof status.installed).toBe("boolean");
		expect(status.modelsDir).toBeDefined();
	});

	it("returns error if synthesizeAudioWithApi is called with empty text", async () => {
		const result = await synthesizeAudioWithApi({
			text: "   ",
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("No text provided");
	});

	it("returns error if synthesizeAudioWithLocalEngine is called with empty text", async () => {
		const result = await synthesizeAudioWithLocalEngine({
			text: "   ",
			referenceAudioPath: "/fake/ref.wav",
			referenceTranscript: "Hello",
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("No text provided");
	});

	it("returns error if API key is missing", async () => {
		vi.mocked(getSecureApiKey).mockReturnValue(null);

		const result = await synthesizeAudioWithApi({
			text: "Hello world voiceover",
			provider: "fish-audio",
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("Missing API key for fish-audio");
	});

	it("calls Fish Audio API successfully when valid key and text provided", async () => {
		vi.mocked(getSecureApiKey).mockReturnValue("fish_test_key_123");

		const fakeAudioBuffer = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF"
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			headers: new Headers({ "content-type": "audio/wav" }),
			arrayBuffer: async () => fakeAudioBuffer.buffer,
		} as Response);

		const result = await synthesizeAudioWithApi({
			text: "Esta es una prueba de doblaje.",
			provider: "fish-audio",
		});

		expect(result.success).toBe(true);
		expect(result.dubbedAudioPath).toBeDefined();
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://api.fish.audio/v1/tts",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer fish_test_key_123",
				}),
			}),
		);
	});

	it("generates sample-accurate silence WAV buffer with valid RIFF header", () => {
		const buf = createSilenceWavBuffer(0.5, 48000, 2);
		expect(buf.length).toBeGreaterThan(44);
		expect(buf.toString("utf8", 0, 4)).toBe("RIFF");
		expect(buf.toString("utf8", 8, 12)).toBe("WAVE");
		expect(buf.toString("utf8", 12, 16)).toBe("fmt ");
		expect(buf.toString("utf8", 36, 40)).toBe("data");

		// 0.5s * 48000 frames * 4 bytes/frame = 96000 data bytes
		const dataSize = buf.readUInt32LE(40);
		expect(dataSize).toBe(96000);
		expect(buf.length).toBe(44 + 96000);

		// Zero 220Hz sine tone verification: PCM samples must all be 0 (pure silence)
		for (let i = 44; i < Math.min(1000, buf.length); i++) {
			expect(buf[i]).toBe(0);
		}
	});

	it("returns error if synthesizeDubbedSegments is called with empty cues", async () => {
		const result = await synthesizeDubbedSegments({
			cues: [],
			referenceAudioPath: "/fake/ref.wav",
			backend: "cloud",
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("No cues provided");
	});

	it("returns error if synthesizeDubbedSegments is missing cloud API key", async () => {
		vi.mocked(getSecureApiKey).mockReturnValue(null);

		const result = await synthesizeDubbedSegments({
			cues: [{ id: "cue-1", text: "Hello", startMs: 0, endMs: 2000 }],
			referenceAudioPath: "/fake/ref.wav",
			backend: "cloud",
			provider: "fish-audio",
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("Missing API key for fish-audio");
	});

	it("handles cancelDubbingSynthesis cleanly", async () => {
		const cancelRes = await cancelDubbingSynthesis();
		expect(cancelRes.success).toBe(true);
		expect(cancelRes.canceled).toBe(true);
	});
});
