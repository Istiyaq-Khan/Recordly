import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
	app: {
		getPath: () => "/tmp/recordly-test",
	},
	safeStorage: {
		isEncryptionAvailable: () => true,
		encryptString: (str: string) => Buffer.from(str).toString("base64"),
		decryptString: (buf: Buffer) =>
			Buffer.from(buf.toString("utf8"), "base64").toString("utf8"),
	},
	ipcMain: {
		handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
			handlers.set(channel, handler);
		}),
	},
}));

vi.mock("../dubbing/fishAudio", () => ({
	checkLocalDubbingEngineStatus: vi
		.fn()
		.mockResolvedValue({ installed: true, executablePath: "/mock/python" }),
	synthesizeAudioWithApi: vi
		.fn()
		.mockResolvedValue({ success: true, dubbedAudioPath: "/out/api.wav", durationMs: 4500 }),
	synthesizeAudioWithLocalEngine: vi
		.fn()
		.mockResolvedValue({ success: true, dubbedAudioPath: "/out/local.wav", durationMs: 4500 }),
}));

vi.mock("../dubbing/referenceAudio", () => ({
	extractVoiceReferenceSample: vi.fn().mockResolvedValue({
		success: true,
		referenceAudioPath: "/out/sample.wav",
		durationMs: 6000,
		suggestedTranscript: "Test speech transcript",
	}),
	importVoiceReferenceFile: vi.fn().mockResolvedValue({
		success: true,
		referenceAudioPath: "/out/upload.wav",
		durationMs: 7000,
		suggestedTranscript: "Uploaded sample transcript",
	}),
	saveLiveVoiceReference: vi.fn().mockResolvedValue({
		success: true,
		referenceAudioPath: "/out/recorded.wav",
		durationMs: 8000,
		suggestedTranscript: "Recorded sample transcript",
	}),
	transcribeVoiceReferenceSample: vi.fn().mockResolvedValue({
		success: true,
		transcript: "Re-transcribed sample transcript",
	}),
}));

vi.mock("../dubbing/translation", () => ({
	getTranslationModelStatus: vi
		.fn()
		.mockResolvedValue({ success: true, exists: true, path: "/models/int8" }),
	downloadTranslationModel: vi.fn().mockResolvedValue({ success: true, path: "/models/int8" }),
	translateTranscript: vi.fn().mockResolvedValue({
		success: true,
		translatedCues: [{ id: "c1", text: "Hola mundo" }],
		fullText: "Hola mundo",
	}),
}));

vi.mock("../dubbing/captionAlignment", () => ({
	alignDubbedCaptions: vi.fn().mockResolvedValue({
		success: true,
		cues: [{ id: "c1", startMs: 0, endMs: 2000, text: "Hola mundo" }],
	}),
}));

import { resolveFloresLanguageCode, SUPPORTED_DUBBING_LANGUAGES } from "../dubbing/nllbLanguages";
import { registerDubbingHandlers } from "./dubbing";

describe("Dubbing IPC Handlers", () => {
	beforeEach(() => {
		handlers.clear();
		registerDubbingHandlers();
	});

	it("registers all required dubbing IPC channels", () => {
		const expectedChannels = [
			"dubbing:get-status",
			"dubbing:get-supported-languages",
			"dubbing:get-translation-model-status",
			"dubbing:download-translation-model",
			"dubbing:extract-voice-reference",
			"dubbing:translate",
			"dubbing:synthesize-api",
			"dubbing:synthesize-local",
			"dubbing:align-captions",
			"dubbing:save-api-key",
			"dubbing:get-api-keys",
		];

		for (const channel of expectedChannels) {
			expect(handlers.has(channel)).toBe(true);
		}
	});

	it("returns supported dubbing languages list", async () => {
		const handler = handlers.get("dubbing:get-supported-languages")!;
		const result = await handler({} as unknown as Electron.IpcMainInvokeEvent);
		expect(Array.isArray(result)).toBe(true);
		expect((result as unknown[]).length).toBe(SUPPORTED_DUBBING_LANGUAGES.length);
	});

	it("handles translation model status query for user-selected quantization", async () => {
		const handler = handlers.get("dubbing:get-translation-model-status")!;
		const res = (await handler({} as unknown as Electron.IpcMainInvokeEvent, "int8")) as Record<
			string,
			unknown
		>;
		expect(res.success).toBe(true);
		expect(res.exists).toBe(true);
		expect(res.path).toBe("/models/int8");
	});

	it("handles reference audio extraction request", async () => {
		const handler = handlers.get("dubbing:extract-voice-reference")!;
		const res = (await handler({} as unknown as Electron.IpcMainInvokeEvent, {
			videoPath: "/input/video.mp4",
		})) as Record<string, unknown>;
		expect(res.success).toBe(true);
		expect(res.referenceAudioPath).toBe("/out/sample.wav");
		expect(res.suggestedTranscript).toBe("Test speech transcript");
	});

	it("handles voice reference file import", async () => {
		const handler = handlers.get("dubbing:import-voice-reference-file")!;
		const res = (await handler({} as unknown as Electron.IpcMainInvokeEvent, {
			filePath: "/input/voice.wav",
		})) as Record<string, unknown>;
		expect(res.success).toBe(true);
		expect(res.referenceAudioPath).toBe("/out/upload.wav");
		expect(res.suggestedTranscript).toBe("Uploaded sample transcript");
	});

	it("handles live voice reference recording buffer", async () => {
		const handler = handlers.get("dubbing:save-live-voice-reference")!;
		const res = (await handler({} as unknown as Electron.IpcMainInvokeEvent, {
			audioBuffer: new Uint8Array([1, 2, 3]),
		})) as Record<string, unknown>;
		expect(res.success).toBe(true);
		expect(res.referenceAudioPath).toBe("/out/recorded.wav");
		expect(res.suggestedTranscript).toBe("Recorded sample transcript");
	});

	it("handles on-demand audio sample transcription", async () => {
		const handler = handlers.get("dubbing:transcribe-sample")!;
		const res = (await handler({} as unknown as Electron.IpcMainInvokeEvent, {
			audioPath: "/cache/sample.wav",
		})) as Record<string, unknown>;
		expect(res.success).toBe(true);
		expect(res.transcript).toBe("Re-transcribed sample transcript");
	});

	it("handles text translation via NLLB or API", async () => {
		const handler = handlers.get("dubbing:translate")!;
		const res = (await handler({} as unknown as Electron.IpcMainInvokeEvent, {
			textCues: [{ id: "c1", text: "Hello world" }],
			targetLang: "es",
			engine: "local-nllb",
			quantization: "int8",
		})) as Record<string, unknown>;
		expect(res.success).toBe(true);
		expect(res.translatedCues).toEqual([{ id: "c1", text: "Hola mundo" }]);
	});

	it("handles audio synthesis via API", async () => {
		const handler = handlers.get("dubbing:synthesize-api")!;
		const res = (await handler({} as unknown as Electron.IpcMainInvokeEvent, {
			text: "Hola mundo",
			referenceAudioPath: "/out/sample.wav",
			referenceTranscript: "Test speech transcript",
			provider: "fish-audio",
		})) as Record<string, unknown>;
		expect(res.success).toBe(true);
		expect(res.dubbedAudioPath).toBe("/out/api.wav");
	});

	it("handles caption alignment", async () => {
		const handler = handlers.get("dubbing:align-captions")!;
		const res = (await handler({} as unknown as Electron.IpcMainInvokeEvent, {
			dubbedAudioPath: "/out/api.wav",
			targetLanguage: "es",
		})) as { success: boolean; cues?: Array<{ text: string }> };
		expect(res.success).toBe(true);
		expect(res.cues).toBeDefined();
		expect(res.cues?.[0]?.text).toBe("Hola mundo");
	});
});

describe("NLLB Language Codes & Resolution", () => {
	it("resolves Flores-200 codes correctly across European, Asian, and Middle Eastern languages", () => {
		expect(resolveFloresLanguageCode("en")).toBe("eng_Latn");
		expect(resolveFloresLanguageCode("es")).toBe("spa_Latn");
		expect(resolveFloresLanguageCode("fr")).toBe("fra_Latn");
		expect(resolveFloresLanguageCode("de")).toBe("deu_Latn");
		expect(resolveFloresLanguageCode("hi")).toBe("hin_Deva");
		expect(resolveFloresLanguageCode("bn")).toBe("ben_Beng");
		expect(resolveFloresLanguageCode("zh")).toBe("zho_Hans");
		expect(resolveFloresLanguageCode("ja")).toBe("jpn_Jpan");
		expect(resolveFloresLanguageCode("ko")).toBe("kor_Hang");
		expect(resolveFloresLanguageCode("ar")).toBe("arb_Arab");
		expect(resolveFloresLanguageCode("ru")).toBe("rus_Cyrl");
	});

	it("falls back to English when code is unrecognized", () => {
		expect(resolveFloresLanguageCode("unknown_xyz")).toBe("eng_Latn");
	});
});
