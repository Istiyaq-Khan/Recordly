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
	cancelTtsModelDownload,
	checkLocalDubbingEngineStatus,
	deleteTtsModel,
	FISH_TTS_MODEL_CONFIGS,
	FISH_TTS_TOKENIZER_CONFIG,
	getTtsModelPath,
	getTtsModelStatus,
	synthesizeAudioWithApi,
	synthesizeAudioWithLocalEngine,
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
});
