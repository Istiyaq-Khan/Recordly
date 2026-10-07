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

import { checkLocalDubbingEngineStatus, synthesizeAudioWithApi } from "./fishAudio";
import { getSecureApiKey } from "./storage";

describe("Fish Audio S2-Pro Engine", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.resetAllMocks();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
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
