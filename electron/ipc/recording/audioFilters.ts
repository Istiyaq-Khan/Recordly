// Keep native mic capture dry by default. Automatic loudness normalization
// amplified wireless-headset noise and WASAPI discontinuities during beta tests.
export const WINDOWS_NATIVE_MIC_PRE_FILTERS = ["adeclip=threshold=1"];

// Browser mic fallback: use transparent high-fidelity filtering suitable for
// condenser and studio microphones without aggressive lowpass or spectral subtraction.
export const BROWSER_MIC_SIDECAR_BASE_FILTERS = ["highpass=f=40"];

export const BROWSER_MIC_SIDECAR_NO_AGC_GAIN_FILTERS = [
	"speechnorm=p=0.92:e=12:c=2:r=0.0005:f=0.001",
	"alimiter=limit=0.98:level=0",
];

export const BROWSER_MIC_SIDECAR_FILTERS = [
	...BROWSER_MIC_SIDECAR_BASE_FILTERS,
	"alimiter=limit=0.98:level=0",
];

export function getBrowserMicSidecarFilters(profile?: string | null) {
	if (profile === "raw") {
		return ["alimiter=limit=0.98:level=0"];
	}
	if (profile === "no-agc") {
		return [...BROWSER_MIC_SIDECAR_BASE_FILTERS, ...BROWSER_MIC_SIDECAR_NO_AGC_GAIN_FILTERS];
	}

	return BROWSER_MIC_SIDECAR_FILTERS;
}

export const RECORDING_AUDIO_SIDECAR_DEBUG_ENV = "RECORDLY_KEEP_RECORDING_AUDIO_SIDECARS"; // not used yet, because we need to have seperate audio files for system and mic for each recording

export function shouldKeepRecordingAudioSidecars(env: NodeJS.ProcessEnv = process.env) {
	const value = env[RECORDING_AUDIO_SIDECAR_DEBUG_ENV]?.trim().toLowerCase();
	return value === "1" || value === "true" || value === "yes" || value === "on";
}
