import { describe, expect, it } from "vitest";
import { buildResolvedAudioPlan, type ResolvedAudioPlan } from "@/lib/exporter/audioRoutingEngine";
import { resolveSourceTrackRoutingPolicy } from "@/lib/exporter/sourceTrackRoutingPolicy";
import { resolveFloresLanguageCode } from "../../../../electron/ipc/dubbing/nllbLanguages";
import { DEFAULT_EDITOR_PREFERENCES, normalizeEditorPreferences } from "../editorPreferences";
import { normalizeProjectEditor } from "../projectPersistence";
import type { DubbingTrack } from "../types";
import { QUANTIZATION_OPTIONS, SUPPORTED_DUBBING_LANGUAGES } from "./constants";

describe("AI Dubbing Configuration & Languages", () => {
	it("provides valid quantization options with int8, fp16, and fp32", () => {
		const ids = QUANTIZATION_OPTIONS.map((q) => q.id);
		expect(ids).toContain("int8");
		expect(ids).toContain("fp16");
		expect(ids).toContain("fp32");
		expect(QUANTIZATION_OPTIONS.find((q) => q.id === "int8")?.size).toBe("~300 MB");
	});

	it("supports standard language codes and maps correctly to Flores-200", () => {
		expect(SUPPORTED_DUBBING_LANGUAGES.length).toBeGreaterThanOrEqual(30);
		expect(resolveFloresLanguageCode("es")).toBe("spa_Latn");
		expect(resolveFloresLanguageCode("fr")).toBe("fra_Latn");
		expect(resolveFloresLanguageCode("de")).toBe("deu_Latn");
		expect(resolveFloresLanguageCode("hi")).toBe("hin_Deva");
		expect(resolveFloresLanguageCode("bn")).toBe("ben_Beng");
		expect(resolveFloresLanguageCode("zh")).toBe("zho_Hans");
		expect(resolveFloresLanguageCode("ja")).toBe("jpn_Jpan");
	});
});

describe("Audio Routing with Dubbed Track", () => {
	const sampleDubbingTrack: DubbingTrack = {
		id: "dub-123",
		targetLanguage: "es",
		dubbedAudioPath: "/cache/dubbed_es.wav",
		isActive: true,
		volume: 0.8,
		syncedCaptions: [{ start: 0, end: 2, text: "Hola mundo" }],
	};

	it("replaces original microphone track with dubbed track when dubbingTrack is active", () => {
		const plan: ResolvedAudioPlan = buildResolvedAudioPlan({
			videoUrl: "/videos/recording.mp4",
			sourceAudioFallbackPaths: ["/videos/recording.mic.m4a", "/videos/recording.system.wav"],
			dubbingTrack: sampleDubbingTrack,
		});

		expect(plan.playbackPaths).toContain("/cache/dubbed_es.wav");
		expect(plan.playbackPaths).toContain("/videos/recording.system.wav");
		// Microphone sidecar must NOT be routed when dubbingTrack is active
		expect(plan.playbackPaths).not.toContain("/videos/recording.mic.m4a");
	});

	it("restores original microphone track when dubbingTrack is inactive", () => {
		const inactiveDubbingTrack: DubbingTrack = {
			...sampleDubbingTrack,
			isActive: false,
		};

		const plan: ResolvedAudioPlan = buildResolvedAudioPlan({
			videoUrl: "/videos/recording.mp4",
			sourceAudioFallbackPaths: ["/videos/recording.mic.m4a", "/videos/recording.system.wav"],
			dubbingTrack: inactiveDubbingTrack,
		});

		expect(plan.playbackPaths).toContain("/videos/recording.mic.m4a");
		expect(plan.playbackPaths).toContain("/videos/recording.system.wav");
		expect(plan.playbackPaths).not.toContain("/cache/dubbed_es.wav");
	});

	it("updates source track routing policy when dubbingTrack is active", () => {
		const policy = resolveSourceTrackRoutingPolicy(
			"/videos/recording.mp4",
			["/videos/recording.mic.m4a"],
			sampleDubbingTrack,
		);

		expect(policy.playbackPaths).toContain("/cache/dubbed_es.wav");
		expect(policy.playbackPaths).not.toContain("/videos/recording.mic.m4a");
	});
});

describe("Project Persistence & Editor Preferences", () => {
	it("normalizes and restores dubbingTrack in project state", () => {
		const rawEditorState = {
			dubbingTrack: {
				id: "dub-xyz",
				targetLanguage: "fr",
				dubbedAudioPath: "/path/to/dubbed.wav",
				isActive: true,
				volume: 0.9,
				syncedCaptions: [{ start: 0, end: 1, text: "Bonjour" }],
			},
		};

		const normalized = normalizeProjectEditor(rawEditorState as never);
		expect(normalized.dubbingTrack).toBeDefined();
		expect(normalized.dubbingTrack?.targetLanguage).toBe("fr");
		expect(normalized.dubbingTrack?.isActive).toBe(true);
		expect(normalized.dubbingTrack?.volume).toBe(0.9);
	});

	it("persists user preferences for quantization model and translation engine", () => {
		const customPrefs = normalizeEditorPreferences({
			...DEFAULT_EDITOR_PREFERENCES,
			dubbingTargetLanguage: "de",
			dubbingTranslationEngine: "local-nllb",
			dubbingTranslationQuantization: "fp16",
			dubbingTtsBackend: "local",
		});

		expect(customPrefs.dubbingTargetLanguage).toBe("de");
		expect(customPrefs.dubbingTranslationQuantization).toBe("fp16");
		expect(customPrefs.dubbingTtsBackend).toBe("local");
	});
});
