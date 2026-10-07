import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: () => "/tmp/recordly-test",
	},
}));

vi.mock("./storage", () => ({
	getSecureApiKey: vi.fn(),
	saveSecureApiKey: vi.fn(),
}));

import { getSecureApiKey } from "./storage";
import {
	getTranslationModelDir,
	getTranslationModelFilePath,
	getTranslationModelStatus,
	translateTranscript,
} from "./translation";

describe("Translation Model Paths and Quantization", () => {
	it("generates distinct model paths for each quantization level", () => {
		const int8Dir = getTranslationModelDir("int8");
		const fp16Dir = getTranslationModelDir("fp16");
		const fp32Dir = getTranslationModelDir("fp32");

		expect(int8Dir).toContain("int8");
		expect(fp16Dir).toContain("fp16");
		expect(fp32Dir).toContain("fp32");

		const int8File = getTranslationModelFilePath("int8");
		const fp16File = getTranslationModelFilePath("fp16");
		const fp32File = getTranslationModelFilePath("fp32");

		expect(int8File).toContain("decoder_model_merged_quantized.onnx");
		expect(fp16File).toContain("decoder_model_merged_fp16.onnx");
		expect(fp32File).toContain("decoder_model_merged.onnx");
	});

	it("returns status indicating model is not downloaded when file is absent", async () => {
		const status = await getTranslationModelStatus("int8");
		expect(status.success).toBe(true);
		expect(status.quantization).toBe("int8");
	});
});

describe("translateTranscript", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.resetAllMocks();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns empty result if textCues is empty", async () => {
		const result = await translateTranscript({
			textCues: [],
			targetLang: "es",
		});
		expect(result.success).toBe(true);
		expect(result.translatedCues).toEqual([]);
		expect(result.fullText).toBe("");
	});

	it("returns error if API engine selected but no API key is provided or stored", async () => {
		vi.mocked(getSecureApiKey).mockReturnValue(null);

		const result = await translateTranscript({
			textCues: [{ id: "c1", text: "Hello world" }],
			targetLang: "es",
			engine: "api",
			apiProvider: "openai",
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain("No API key configured for openai");
	});

	it("translates cues via OpenAI API when configured", async () => {
		vi.mocked(getSecureApiKey).mockReturnValue("test-sk-key");

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				choices: [{ message: { content: "Hola mundo" } }],
			}),
		} as Response);

		const result = await translateTranscript({
			textCues: [{ id: "c1", text: "Hello world" }],
			targetLang: "es",
			engine: "api",
			apiProvider: "openai",
		});

		expect(result.success).toBe(true);
		expect(result.translatedCues?.[0].text).toBe("Hola mundo");
		expect(result.fullText).toBe("Hola mundo");
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://api.openai.com/v1/chat/completions",
			expect.objectContaining({
				method: "POST",
			}),
		);
	});

	it("translates cues via DeepL API when configured", async () => {
		vi.mocked(getSecureApiKey).mockReturnValue("test-deepl-key:fx");

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				translations: [{ text: "Bonjour le monde" }],
			}),
		} as Response);

		const result = await translateTranscript({
			textCues: [{ id: "c1", text: "Hello world" }],
			targetLang: "fr",
			engine: "api",
			apiProvider: "deepl",
		});

		expect(result.success).toBe(true);
		expect(result.translatedCues?.[0].text).toBe("Bonjour le monde");
		expect(result.fullText).toBe("Bonjour le monde");
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://api-free.deepl.com/v2/translate",
			expect.objectContaining({
				method: "POST",
			}),
		);
	});
});
