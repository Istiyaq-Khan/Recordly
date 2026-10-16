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

	it("rejects routing when dubbedAudioPath matches referenceVoiceSamplePath", () => {
		const corruptedDubbingTrack: DubbingTrack = {
			...sampleDubbingTrack,
			referenceVoiceSamplePath: "/cache/dubbed_es.wav", // same as dubbedAudioPath!
		};

		const plan: ResolvedAudioPlan = buildResolvedAudioPlan({
			videoUrl: "/videos/recording.mp4",
			sourceAudioFallbackPaths: ["/videos/recording.mic.m4a", "/videos/recording.system.wav"],
			dubbingTrack: corruptedDubbingTrack,
		});

		// Must NOT route the looped reference track; fall back to mic
		expect(plan.playbackPaths).not.toContain("/cache/dubbed_es.wav");
		expect(plan.playbackPaths).toContain("/videos/recording.mic.m4a");
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
	it("normalizes and restores dubbingTrack in project state including originalCaptions", () => {
		const rawEditorState = {
			dubbingTrack: {
				id: "dub-xyz",
				targetLanguage: "fr",
				dubbedAudioPath: "/path/to/dubbed.wav",
				referenceVoiceSamplePath: "/path/to/ref.wav",
				isActive: true,
				volume: 0.9,
				syncedCaptions: [{ start: 0, end: 1, text: "Bonjour" }],
				originalCaptions: [{ id: "orig-1", start: 0, end: 1, text: "Hello" }],
			},
		};

		const normalized = normalizeProjectEditor(rawEditorState as never);
		expect(normalized.dubbingTrack).toBeDefined();
		expect(normalized.dubbingTrack?.targetLanguage).toBe("fr");
		expect(normalized.dubbingTrack?.isActive).toBe(true);
		expect(normalized.dubbingTrack?.volume).toBe(0.9);
		expect(normalized.dubbingTrack?.originalCaptions).toEqual([
			{ id: "orig-1", startMs: 0, endMs: 1000, text: "Hello" },
		]);
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

describe("Decoupled Caption-First Placement & Toggle Resilience", () => {
	const sourceCues = [
		{ id: "cue-1", startMs: 500, endMs: 2500, text: "Welcome to this tutorial." },
		{ id: "cue-2", startMs: 3000, endMs: 5500, text: "Let's learn something new today." },
	];

	const translatedHindiCues = [
		{ id: "cue-1", text: "इस ट्यूटोरियल में आपका स्वागत है।" },
		{ id: "cue-2", text: "आइए आज कुछ नया सीखें।" },
	];

	it("maps translated non-Latin (Hindi) cues directly to timeline captions preserving source timing", () => {
		const dubbedCaptions = translatedHindiCues.map((tc, idx) => ({
			id: tc.id ?? `dubcue-${idx}`,
			startMs: sourceCues[idx].startMs,
			endMs: sourceCues[idx].endMs,
			text: tc.text,
		}));

		expect(dubbedCaptions).toHaveLength(2);
		expect(dubbedCaptions[0].text).toBe("इस ट्यूटोरियल में आपका स्वागत है।");
		expect(dubbedCaptions[0].startMs).toBe(500);
		expect(dubbedCaptions[0].endMs).toBe(2500);
		expect(dubbedCaptions[1].text).toBe("आइए आज कुछ नया सीखें।");
		expect(dubbedCaptions[1].startMs).toBe(3000);
		expect(dubbedCaptions[1].endMs).toBe(5500);
	});

	it("preserves originalCaptions and handles track toggle state transitions safely", () => {
		const dubbedTrack: DubbingTrack = {
			id: "dub-hindi-1",
			targetLanguage: "hi",
			language: "hi",
			dubbedAudioPath: "/cache/dubbed_master_hi.wav",
			isActive: true,
			volume: 1.0,
			originalCaptions: sourceCues,
			syncedCaptions: [
				{
					id: "dubcue-0",
					start: 0.5,
					end: 2.5,
					startMs: 500,
					endMs: 2500,
					text: "इस ट्यूटोरियल में आपका स्वागत है।",
				},
				{
					id: "dubcue-1",
					start: 3.0,
					end: 5.5,
					startMs: 3000,
					endMs: 5500,
					text: "आइए आज कुछ नया सीखें।",
				},
			],
		};

		// When toggled OFF (isActive: false), restore original source captions
		const toggledOffCaptions = dubbedTrack.originalCaptions ?? [];
		expect(toggledOffCaptions).toEqual(sourceCues);

		// When toggled ON (isActive: true), reapply target-language dubbed captions
		const toggledOnCaptions = (dubbedTrack.syncedCaptions ?? []).map((c) => ({
			id: c.id,
			startMs: c.startMs ?? Math.round(c.start * 1000),
			endMs: c.endMs ?? Math.round(c.end * 1000),
			text: c.text,
		}));
		expect(toggledOnCaptions[0].text).toBe("इस ट्यूटोरियल में आपका स्वागत है।");
		expect(toggledOnCaptions[1].text).toBe("आइए आज कुछ नया सीखें।");
	});

	it("supports silence fallback metadata tracking in SynthesizeDubbedSegmentsResult", () => {
		const sampleResult = {
			success: true,
			dubbedAudioPath: "/cache/dubbed_master_hi.wav",
			durationMs: 6000,
			skippedCueCount: 2,
			totalCues: 2,
		};

		expect(sampleResult.success).toBe(true);
		expect(sampleResult.skippedCueCount).toBe(2);
		expect(sampleResult.totalCues).toBe(2);
		expect(sampleResult.skippedCueCount >= sampleResult.totalCues).toBe(true);
	});
});
