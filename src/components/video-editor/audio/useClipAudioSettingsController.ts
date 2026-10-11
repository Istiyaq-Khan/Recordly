import React, { useCallback, useMemo } from "react";
import {
	SOURCE_AUDIO_NORMALIZE_GAIN,
	type SourceAudioTrackSettings,
} from "@/components/video-editor/audio/audioTypes";
import type { DubbingTrack } from "@/components/video-editor/types";
import { useSourceAudioTrackSettings } from "./useSourceAudioTrackSettings";
import { getSourceTrackIdFromPath } from "@/lib/exporter/audioRoutingEngine";

interface UseClipAudioSettingsControllerParams {
	selectedClipId: string | null;
	activeClipId: string | null;
	sourceAudioTrackSettingsByClip: Record<string, SourceAudioTrackSettings>;
	setSourceAudioTrackSettingsByClip: React.Dispatch<
		React.SetStateAction<Record<string, SourceAudioTrackSettings>>
	>;
	defaultSourceAudioTrackSettings: SourceAudioTrackSettings;
	setDefaultSourceAudioTrackSettings: React.Dispatch<
		React.SetStateAction<SourceAudioTrackSettings>
	>;
	dubbingTrack?: DubbingTrack | null;
}

export function useClipAudioSettingsController({
	selectedClipId,
	activeClipId,
	sourceAudioTrackSettingsByClip,
	setSourceAudioTrackSettingsByClip,
	defaultSourceAudioTrackSettings,
	setDefaultSourceAudioTrackSettings,
	dubbingTrack,
}: UseClipAudioSettingsControllerParams) {
	const {
		sourceAudioTrackMeta,
		activeSourceAudioTrackSettings,
		selectedClipSourceAudioTrackSettings,
		getSourceAudioTrackSettingsForClip,
		onSourceAudioTracksMetaChange,
		onSelectedClipSourceAudioTrackVolumeChange,
		onSelectedClipSourceAudioTrackNormalizeChange,
	} = useSourceAudioTrackSettings({
		selectedClipId,
		activeClipId,
		sourceAudioTrackSettingsByClip,
		setSourceAudioTrackSettingsByClip,
		defaultSourceAudioTrackSettings,
		setDefaultSourceAudioTrackSettings,
	});

	const previewSourceAudioTrackSettings = useMemo(
		() =>
			activeClipId ? activeSourceAudioTrackSettings : selectedClipSourceAudioTrackSettings,
		[activeClipId, activeSourceAudioTrackSettings, selectedClipSourceAudioTrackSettings],
	);

	const embeddedTrackId = useMemo<"mixed" | "system">(() => {
		const hasMixedTrack = sourceAudioTrackMeta.some((track) => track.id === "mixed");
		if (hasMixedTrack) return "mixed";
		const hasSystemTrack = sourceAudioTrackMeta.some((track) => track.id === "system");
		return hasSystemTrack ? "system" : "mixed";
	}, [sourceAudioTrackMeta]);

	const embeddedSourcePreviewGain = useMemo(() => {
		const settings = previewSourceAudioTrackSettings[embeddedTrackId] ?? {
			volume: 1,
			normalize: false,
		};
		const normalizeGain = settings.normalize ? SOURCE_AUDIO_NORMALIZE_GAIN : 1;
		return Math.max(0, Math.min(1, settings.volume * normalizeGain));
	}, [embeddedTrackId, previewSourceAudioTrackSettings]);

	const getSourceTrackPreviewGain = useCallback(
		(audioPath: string) => {
			const isDubbedTrack = Boolean(
				dubbingTrack?.isActive &&
					dubbingTrack.dubbedAudioPath &&
					audioPath === dubbingTrack.dubbedAudioPath,
			);
			const trackId = isDubbedTrack ? "dubbing" : getSourceTrackIdFromPath(audioPath);
			if (trackId === "dubbing") {
				return Math.max(0, Math.min(1, dubbingTrack?.volume ?? 1));
			}
			const settings = previewSourceAudioTrackSettings[trackId] ?? {
				volume: 1,
				normalize: false,
			};
			const normalizeGain = settings.normalize ? SOURCE_AUDIO_NORMALIZE_GAIN : 1;
			return Math.max(0, Math.min(1, settings.volume * normalizeGain));
		},
		[previewSourceAudioTrackSettings, dubbingTrack],
	);

	return {
		sourceAudioTrackMeta,
		activeSourceAudioTrackSettings,
		selectedClipSourceAudioTrackSettings,
		getSourceAudioTrackSettingsForClip,
		onSourceAudioTracksMetaChange,
		onSelectedClipSourceAudioTrackVolumeChange,
		onSelectedClipSourceAudioTrackNormalizeChange,
		embeddedSourcePreviewGain,
		getSourceTrackPreviewGain,
	};
}
