import { describe, expect, it } from "vitest";
import { resolveSourceTrackRoutingPolicy } from "./sourceTrackRoutingPolicy";

describe("resolveSourceTrackRoutingPolicy", () => {
	it("prioritizes system+mic sidecars and mutes embedded preview", () => {
		const policy = resolveSourceTrackRoutingPolicy("/tmp/recording.mp4", [
			"/tmp/recording.mp4",
			"/tmp/recording.system.wav",
			"/tmp/recording.mic.wav",
			"/tmp/recording.mixed.wav",
		]);

		expect(policy.playbackPaths).toEqual([
			"/tmp/recording.system.wav",
			"/tmp/recording.mic.wav",
		]);
		expect(policy.muteEmbeddedPreview).toBe(true);
		expect(policy.includeEmbeddedInExport).toBe(false);
	});

	it("falls back to mixed when dedicated tracks are absent", () => {
		const policy = resolveSourceTrackRoutingPolicy("/tmp/recording.mp4", [
			"/tmp/recording.mixed.wav",
		]);

		expect(policy.playbackPaths).toEqual(["/tmp/recording.mixed.wav"]);
		expect(policy.muteEmbeddedPreview).toBe(false);
		expect(policy.includeEmbeddedInExport).toBe(false);
	});

	it("keeps embedded audio when only mic sidecar is present", () => {
		const policy = resolveSourceTrackRoutingPolicy("/tmp/recording.mp4", [
			"/tmp/recording.mp4",
			"/tmp/recording.mic.wav",
		]);

		expect(policy.playbackPaths).toEqual(["/tmp/recording.mic.wav"]);
		expect(policy.muteEmbeddedPreview).toBe(false);
		expect(policy.includeEmbeddedInExport).toBe(true);
	});

	it("replaces mic sidecar with dubbed audio when dubbingTrack is active", () => {
		const policy = resolveSourceTrackRoutingPolicy(
			"/tmp/recording.mp4",
			[
				"/tmp/recording.system.wav",
				"/tmp/recording.mic.wav",
			],
			{
				id: "dub-1",
				targetLanguage: "es",
				dubbedAudioPath: "/tmp/dubbed.wav",
				isActive: true,
				syncedCaptions: [],
			},
		);

		expect(policy.playbackPaths).toContain("/tmp/recording.system.wav");
		expect(policy.playbackPaths).toContain("/tmp/dubbed.wav");
		expect(policy.playbackPaths).not.toContain("/tmp/recording.mic.wav");
	});

	it("keeps original mic sidecar when dubbingTrack is inactive", () => {
		const policy = resolveSourceTrackRoutingPolicy(
			"/tmp/recording.mp4",
			[
				"/tmp/recording.system.wav",
				"/tmp/recording.mic.wav",
			],
			{
				id: "dub-1",
				targetLanguage: "es",
				dubbedAudioPath: "/tmp/dubbed.wav",
				isActive: false,
				syncedCaptions: [],
			},
		);

		expect(policy.playbackPaths).toContain("/tmp/recording.system.wav");
		expect(policy.playbackPaths).toContain("/tmp/recording.mic.wav");
		expect(policy.playbackPaths).not.toContain("/tmp/dubbed.wav");
	});
});
