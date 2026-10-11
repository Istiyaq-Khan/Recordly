import type { AudioRegion, DubbingTrack } from "@/components/video-editor/types";
import { SOURCE_AUDIO_NORMALIZE_GAIN } from "@/components/video-editor/audio/audioTypes";
import { resolveSourceAudioFallbackPaths } from "./sourceAudioFallback";

export type SourceTrackId = "mic" | "system" | "mixed" | "dubbing";
export type ResolvedAudioTrackKind = "user" | "system" | "mic" | "mixed" | "embedded" | "dubbing";

export interface ResolvedAudioTrack {
	id: string;
	kind: ResolvedAudioTrackKind;
	sourceRef: {
		path: string;
		startDelayMs: number;
	};
	gain: number;
	timelineBinding: {
		startMs: number;
		endMs: number;
	};
}

export interface ResolvedAudioPlan {
	hasEmbeddedSourceAudio: boolean;
	pathsByTrack: Partial<Record<SourceTrackId, string>>;
	playbackPaths: string[];
	muteEmbeddedPreview: boolean;
	includeEmbeddedInExport: boolean;
	tracks: ResolvedAudioTrack[];
	masterGain: number;
}

export function getSourceTrackIdFromPath(audioPath: string): SourceTrackId {
	const normalized = audioPath.toLowerCase();
	if (normalized.includes("dubbed")) return "dubbing";
	if (normalized.includes(".mic.")) return "mic";
	if (normalized.includes(".system.")) return "system";
	return "mixed";
}

function clampGain(value: number, max: number) {
	if (!Number.isFinite(value)) return 1;
	return Math.max(0, Math.min(max, value));
}

export function buildResolvedAudioPlan(input: {
	videoResource: string | null | undefined;
	sourceAudioFallbackPaths: string[] | null | undefined;
	audioRegions?: AudioRegion[];
	dubbingTrack?: DubbingTrack | null;
	sourceTrackGainById?: Partial<Record<SourceTrackId, number>>;
	embeddedGain?: number;
	masterGain?: number;
}): ResolvedAudioPlan {
	const { hasEmbeddedSourceAudio, externalAudioPaths } = resolveSourceAudioFallbackPaths(
		input.videoResource,
		input.sourceAudioFallbackPaths,
	);

	const pathsByTrack: Partial<Record<SourceTrackId, string>> = {};
	for (const path of externalAudioPaths) {
		const trackId = getSourceTrackIdFromPath(path);
		if (!pathsByTrack[trackId]) {
			pathsByTrack[trackId] = path;
		}
	}

	const rawDubbedAudioPath = input.dubbingTrack?.dubbedAudioPath?.trim();
	const refSamplePath = input.dubbingTrack?.referenceVoiceSamplePath?.trim();
	const isDubbingPathValid = Boolean(
		rawDubbedAudioPath &&
			rawDubbedAudioPath.length > 0 &&
			(!refSamplePath || rawDubbedAudioPath !== refSamplePath),
	);

	if (input.dubbingTrack?.isActive && !isDubbingPathValid) {
		if (!rawDubbedAudioPath) {
			console.warn(
				"[audioRoutingEngine] Assertion failed: dubbedAudioPath is empty on active dubbing track.",
			);
		} else if (refSamplePath && rawDubbedAudioPath === refSamplePath) {
			console.error(
				"[audioRoutingEngine] Assertion failed: dubbedAudioPath cannot point to referenceVoiceSamplePath. Discarding dubbed track to prevent reference loop.",
			);
		}
	}

	const isDubbingActive = Boolean(input.dubbingTrack?.isActive && isDubbingPathValid);
	const hasDedicatedTracks = Boolean(
		pathsByTrack.system || pathsByTrack.mic || isDubbingActive,
	);
	const playbackPaths: string[] = [];
	if (pathsByTrack.system) playbackPaths.push(pathsByTrack.system);

	// If dubbing is active, replace original mic track with dubbed audio track
	if (isDubbingActive && rawDubbedAudioPath) {
		playbackPaths.push(rawDubbedAudioPath);
	} else if (pathsByTrack.mic) {
		playbackPaths.push(pathsByTrack.mic);
	}

	if (!hasDedicatedTracks && pathsByTrack.mixed) playbackPaths.push(pathsByTrack.mixed);

	const includeEmbeddedInExport = !pathsByTrack.system && !pathsByTrack.mixed;
	const resolvedRegions = (input.audioRegions ?? [])
		.slice()
		.sort((a, b) => a.startMs - b.startMs);
	const tracks: ResolvedAudioTrack[] = resolvedRegions.map((region) => ({
		id: `user:${region.id}`,
		kind: "user",
		sourceRef: {
			path: region.audioPath,
			startDelayMs: 0,
		},
		gain: clampGain(region.volume * (region.normalize ? SOURCE_AUDIO_NORMALIZE_GAIN : 1), 1),
		timelineBinding: {
			startMs: Math.max(0, region.startMs),
			endMs: Math.max(0, region.endMs),
		},
	}));

	for (const audioPath of playbackPaths) {
		const isDubbedTrack =
			isDubbingActive && audioPath === input.dubbingTrack?.dubbedAudioPath;
		const trackId = isDubbedTrack ? "dubbing" : getSourceTrackIdFromPath(audioPath);
		const gain = isDubbedTrack
			? clampGain(input.dubbingTrack?.volume ?? 1, 2)
			: clampGain(input.sourceTrackGainById?.[trackId as SourceTrackId] ?? 1, 2);

		tracks.push({
			id: `${trackId}:${audioPath}`,
			kind: trackId as ResolvedAudioTrackKind,
			sourceRef: {
				path: audioPath,
				startDelayMs: 0,
			},
			gain,
			timelineBinding: {
				startMs: 0,
				endMs: Number.POSITIVE_INFINITY,
			},
		});
	}

	if (hasEmbeddedSourceAudio && input.videoResource) {
		tracks.push({
			id: `embedded:${input.videoResource}`,
			kind: "embedded",
			sourceRef: {
				path: input.videoResource,
				startDelayMs: 0,
			},
			gain: clampGain(input.embeddedGain ?? input.sourceTrackGainById?.mixed ?? 1, 2),
			timelineBinding: {
				startMs: 0,
				endMs: Number.POSITIVE_INFINITY,
			},
		});
	}

	return {
		hasEmbeddedSourceAudio,
		pathsByTrack,
		playbackPaths,
		muteEmbeddedPreview: hasDedicatedTracks && !includeEmbeddedInExport,
		includeEmbeddedInExport,
		tracks,
		masterGain: clampGain(input.masterGain ?? 1, 1),
	};
}
