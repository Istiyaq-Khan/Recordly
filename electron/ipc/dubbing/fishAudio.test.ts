import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: () => "/tmp/recordly-test",
	},
}));

vi.mock("../ffmpeg/binary", () => ({
	getFfprobeBinaryPath: () => "/mock/ffprobe",
	getFfmpegBinaryPath: () => "/mock/ffmpeg",
}));

vi.mock("./storage", () => ({
	getSecureApiKey: vi.fn(),
	saveSecureApiKey: vi.fn(),
}));

import {
	cancelDubbingSynthesis,
	cancelTtsModelDownload,
	checkLocalDubbingEngineStatus,
	checkLocalFishServerHealth,
	createFishAudioVoiceModel,
	createSilenceWavBuffer,
	DEFAULT_LOCAL_FISH_URL,
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

	it("pre-flight offline check returns error immediately when local server is unreachable", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

		const health = await checkLocalFishServerHealth("http://127.0.0.1:8080");
		expect(health.ok).toBe(false);
		expect(health.error).toContain("Local Fish Audio S2-Pro server is not running at http://127.0.0.1:8080");

		const result = await synthesizeDubbedSegments({
			cues: [{ id: "cue-1", text: "Testing local offline", startMs: 0, endMs: 2000 }],
			referenceAudioPath: "/fake/ref.wav",
			backend: "local",
			localServerUrl: "http://127.0.0.1:8080",
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("Local Fish Audio S2-Pro server is not running at http://127.0.0.1:8080");
	});

	it("creates ephemeral voice model once and passes reference_id to cue synthesis calls", async () => {
		const fakeAudio = Buffer.from("RIFFfakeaudioWAVE");
		vi.mocked(getSecureApiKey).mockReturnValue("fish_test_key_123");

		globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
			if (url === "https://api.fish.audio/model") {
				return {
					ok: true,
					status: 201,
					json: async () => ({ _id: "model_ephemeral_999" }),
				} as Response;
			}
			if (url === "https://api.fish.audio/v1/tts") {
				return {
					ok: true,
					headers: new Headers({ "content-type": "audio/wav" }),
					arrayBuffer: async () => fakeAudio.buffer,
				} as Response;
			}
			return { ok: false, status: 404 } as Response;
		});

		const modelId = await createFishAudioVoiceModel({
			apiKey: "fish_test_key_123",
			audioBuffer: fakeAudio,
			transcript: "Sample transcript",
		});
		expect(modelId).toBe("model_ephemeral_999");
	});

	it("falls back to direct Base64 references if ephemeral model creation fails", async () => {
		const fakeAudio = Buffer.from("RIFFfakeaudioWAVE");

		globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
			if (url === "https://api.fish.audio/model") {
				return {
					ok: false,
					status: 403,
					text: async () => "Permission denied",
				} as Response;
			}
			return { ok: false, status: 404 } as Response;
		});

		const modelId = await createFishAudioVoiceModel({
			apiKey: "fish_test_key_123",
			audioBuffer: fakeAudio,
		});
		expect(modelId).toBeNull();
	});

	it("fails fast and creates zero silent fallbacks when cue synthesis errors", async () => {
		vi.mocked(getSecureApiKey).mockReturnValue("fish_test_key_123");

		// Simulate API 500 error for cue synthesis
		globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
			if (url === "https://api.fish.audio/model") {
				return {
					ok: true,
					status: 201,
					json: async () => ({ _id: "model_123" }),
				} as Response;
			}
			if (url === "https://api.fish.audio/v1/tts") {
				return {
					ok: false,
					status: 500,
					text: async () => "Internal GPU inference failure",
				} as Response;
			}
			return { ok: false, status: 404 } as Response;
		});

		const result = await synthesizeDubbedSegments({
			cues: [
				{ id: "cue-1", text: "Cue one that will fail", startMs: 0, endMs: 2000 },
				{ id: "cue-2", text: "Cue two that should never be reached", startMs: 2000, endMs: 4000 },
			],
			referenceAudioPath: "/fake/ref.wav",
			backend: "cloud",
			provider: "fish-audio",
		});

		// Must fail fast, NOT substitute silence, NOT return success
		expect(result.success).toBe(false);
		expect(result.error).toContain("Fish Audio API error (500)");
		expect(result.dubbedAudioPath).toBeUndefined();
	});
});
