import type { DubbingTrack } from "@/components/video-editor/types";
import { buildResolvedAudioPlan, type SourceTrackId } from "./audioRoutingEngine";

export interface SourceTrackRoutingPolicy {
	hasEmbeddedSourceAudio: boolean;
	pathsByTrack: Partial<Record<SourceTrackId, string>>;
	playbackPaths: string[];
	muteEmbeddedPreview: boolean;
	includeEmbeddedInExport: boolean;
}

export function resolveSourceTrackRoutingPolicy(
	videoResource: string | null | undefined,
	sourceAudioFallbackPaths: string[] | null | undefined,
	dubbingTrack?: DubbingTrack | null,
): SourceTrackRoutingPolicy {
	const plan = buildResolvedAudioPlan({
		videoResource,
		sourceAudioFallbackPaths,
		dubbingTrack,
	});

	return {
		hasEmbeddedSourceAudio: plan.hasEmbeddedSourceAudio,
		pathsByTrack: plan.pathsByTrack,
		playbackPaths: plan.playbackPaths,
		muteEmbeddedPreview: plan.muteEmbeddedPreview,
		includeEmbeddedInExport: plan.includeEmbeddedInExport,
	};
}
