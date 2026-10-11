import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { loadEditorPreferences, saveEditorPreferences } from "../editorPreferences";
import type {
	CaptionCue,
	DubbingApiTranslationProvider,
	DubbingCloudProvider,
	DubbingModelQuantization,
	DubbingSyncedCaptionCue,
	DubbingTrack,
	DubbingTranslationEngine,
	DubbingTtsBackend,
} from "../types";
import type { TtsQuantization } from "./constants";

interface UseDubbingControllerParams {
	videoPath: string | null;
	cues: CaptionCue[];
	dubbingTrack?: DubbingTrack | null;
	setDubbingTrack: (
		track: DubbingTrack | null | ((prev: DubbingTrack | null) => DubbingTrack | null),
	) => void;
	setAutoCaptions?: (cues: CaptionCue[]) => void;
	duration?: number;
	whisperExecutablePath?: string | null;
	whisperModelPath?: string | null;
}

export type DubbingGenerationStage =
	| "idle"
	| "extracting-ref"
	| "translating"
	| "synthesizing"
	| "aligning"
	| "finalizing"
	| "ready"
	| "error";

export interface QuantizationStatus {
	exists: boolean;
	path?: string | null;
	isDownloading: boolean;
	progress: number;
	error?: string;
}

export function useDubbingController({
	videoPath,
	cues,
	dubbingTrack,
	setDubbingTrack,
	setAutoCaptions,
	duration,
	whisperExecutablePath,
	whisperModelPath,
}: UseDubbingControllerParams) {
	const initialPreferences = useRef(loadEditorPreferences());

	// Machine / user preferences
	const [targetLanguage, setTargetLanguage] = useState<string>(
		initialPreferences.current.dubbingTargetLanguage ?? "es",
	);
	const [ttsBackend, setTtsBackend] = useState<DubbingTtsBackend>(
		initialPreferences.current.dubbingTtsBackend ?? "cloud",
	);
	const [cloudProvider, setCloudProvider] = useState<DubbingCloudProvider>(
		initialPreferences.current.dubbingCloudProvider ?? "fish-audio",
	);
	const [translationEngine, setTranslationEngine] = useState<DubbingTranslationEngine>(
		initialPreferences.current.dubbingTranslationEngine ?? "local-nllb",
	);
	const [translationQuantization, setTranslationQuantization] =
		useState<DubbingModelQuantization>(
			initialPreferences.current.dubbingTranslationQuantization ?? "int8",
		);
	const [apiTranslationProvider, setApiTranslationProvider] =
		useState<DubbingApiTranslationProvider>(
			initialPreferences.current.dubbingApiTranslationProvider ?? "openai",
		);

	// API Keys status and input buffer
	const [savedApiKeys, setSavedApiKeys] = useState<Record<string, boolean>>({});
	const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({
		"fish-audio": "",
		acedatacloud: "",
		openai: "",
		deepl: "",
	});

	// Custom OpenAI & OpenAI-compatible endpoint configuration
	const [customOpenAiConfig, setCustomOpenAiConfig] = useState<{
		baseUrl: string;
		model: string;
		hasApiKey?: boolean;
	}>({
		baseUrl: "",
		model: "gpt-4o-mini",
		hasApiKey: false,
	});
	const [customOpenAiInputs, setCustomOpenAiInputs] = useState<{
		apiKey: string;
		baseUrl: string;
		model: string;
	}>({
		apiKey: "",
		baseUrl: "",
		model: "gpt-4o-mini",
	});

	// Per-quantization download status
	const [modelStatusByQuantization, setModelStatusByQuantization] = useState<
		Record<DubbingModelQuantization, QuantizationStatus>
	>({
		int8: { exists: false, isDownloading: false, progress: 0 },
		fp16: { exists: false, isDownloading: false, progress: 0 },
		fp32: { exists: false, isDownloading: false, progress: 0 },
	});

	// Fish Audio S2-Pro Local Engine Quantization & Status
	const [ttsQuantization, setTtsQuantization] = useState<TtsQuantization>("q4_k_m");
	const [ttsModelStatusByQuantization, setTtsModelStatusByQuantization] = useState<
		Record<
			TtsQuantization,
			{
				exists: boolean;
				path?: string | null;
				isDownloading: boolean;
				progress: number;
				downloadedBytes?: number;
				totalBytes?: number;
				speed?: number;
				eta?: number;
				error?: string;
			}
		>
	>({
		q4_k_m: { exists: false, isDownloading: false, progress: 0 },
		q5_k_m: { exists: false, isDownloading: false, progress: 0 },
		q6_k: { exists: false, isDownloading: false, progress: 0 },
		q8_0: { exists: false, isDownloading: false, progress: 0 },
		f16: { exists: false, isDownloading: false, progress: 0 },
		fp16: { exists: false, isDownloading: false, progress: 0 },
	});

	// Voice Reference Sample
	const [voiceSourceMode, setVoiceSourceMode] = useState<"timeline" | "upload" | "record">("timeline");
	const [voiceSourceType, setVoiceSourceType] = useState<"timeline" | "upload" | "record" | null>(null);
	const [referenceAudioPath, setReferenceAudioPath] = useState<string | null>(null);
	const [referenceDurationSec, setReferenceDurationSec] = useState<number>(0);
	const [referenceTranscript, setReferenceTranscript] = useState<string>("");
	const [isExtractingReference, setIsExtractingReference] = useState<boolean>(false);
	const [isUploadingReference, setIsUploadingReference] = useState<boolean>(false);
	const [isSavingLiveReference, setIsSavingLiveReference] = useState<boolean>(false);
	const [isTranscribingReference, setIsTranscribingReference] = useState<boolean>(false);

	// Pipeline execution state
	const [generationStage, setGenerationStage] = useState<DubbingGenerationStage>("idle");
	const [generationProgress, setGenerationProgress] = useState<number>(0);
	const [generationError, setGenerationError] = useState<string | null>(null);
	const [segmentCueProgress, setSegmentCueProgress] = useState<{
		current: number;
		total: number;
	} | null>(null);

	// Sync preferences to disk on change
	const updateTargetLanguage = useCallback((lang: string) => {
		setTargetLanguage(lang);
		saveEditorPreferences({ dubbingTargetLanguage: lang });
	}, []);

	const updateTtsBackend = useCallback((backend: DubbingTtsBackend) => {
		setTtsBackend(backend);
		saveEditorPreferences({ dubbingTtsBackend: backend });
	}, []);

	const updateTtsQuantization = useCallback((quant: TtsQuantization) => {
		setTtsQuantization(quant);
	}, []);

	const updateCloudProvider = useCallback((provider: DubbingCloudProvider) => {
		setCloudProvider(provider);
		saveEditorPreferences({ dubbingCloudProvider: provider });
	}, []);

	const updateTranslationEngine = useCallback((engine: DubbingTranslationEngine) => {
		setTranslationEngine(engine);
		saveEditorPreferences({ dubbingTranslationEngine: engine });
	}, []);

	const updateTranslationQuantization = useCallback((quant: DubbingModelQuantization) => {
		setTranslationQuantization(quant);
		saveEditorPreferences({ dubbingTranslationQuantization: quant });
	}, []);

	const updateApiTranslationProvider = useCallback((provider: DubbingApiTranslationProvider) => {
		setApiTranslationProvider(provider);
		saveEditorPreferences({ dubbingApiTranslationProvider: provider });
	}, []);

	// Refresh saved API key flags and custom OpenAI settings
	const refreshApiKeys = useCallback(async () => {
		if (!window.electronAPI?.getDubbingStatus) {
			if (window.electronAPI?.getDubbingApiKeys) {
				try {
					const keys = await window.electronAPI.getDubbingApiKeys();
					if (keys) setSavedApiKeys(keys);
				} catch (err) {
					console.error("[useDubbingController] Failed to check API keys:", err);
				}
			}
			return;
		}
		try {
			const status = await window.electronAPI.getDubbingStatus();
			if (status) {
				setSavedApiKeys({
					"fish-audio": status.hasFishApiKey,
					acedatacloud: status.hasAceDataApiKey,
					openai: status.hasOpenAiApiKey,
					deepl: status.hasDeepLApiKey,
				});
			}
			if (status?.customOpenAiConfig) {
				const cfg = {
					baseUrl: status.customOpenAiConfig.baseUrl ?? "",
					model: status.customOpenAiConfig.model ?? "gpt-4o-mini",
					hasApiKey: Boolean(
						status.customOpenAiConfig.baseUrl !== undefined ||
						status?.hasOpenAiApiKey
					),
				};
				setCustomOpenAiConfig(cfg);
				setCustomOpenAiInputs((prev) => ({
					...prev,
					baseUrl: cfg.baseUrl,
					model: cfg.model,
				}));
			}
		} catch (err) {
			console.error("[useDubbingController] Failed to check API keys & config:", err);
		}
	}, []);

	// Save custom OpenAI / OpenAI-compatible configuration
	const handleSaveCustomOpenAiConfig = useCallback(async () => {
		if (!window.electronAPI?.saveCustomOpenAiConfig) return;
		try {
			const res = await window.electronAPI.saveCustomOpenAiConfig({
				apiKey: customOpenAiInputs.apiKey.trim() || undefined,
				baseUrl: customOpenAiInputs.baseUrl.trim() || undefined,
				model: customOpenAiInputs.model.trim() || undefined,
			});
			if (res.success) {
				toast.success("Saved OpenAI / Custom endpoint settings");
				setCustomOpenAiConfig({
					baseUrl: customOpenAiInputs.baseUrl.trim(),
					model: customOpenAiInputs.model.trim() || "gpt-4o-mini",
					hasApiKey: Boolean(customOpenAiInputs.apiKey.trim() || customOpenAiConfig.hasApiKey),
				});
				setCustomOpenAiInputs((prev) => ({ ...prev, apiKey: "" }));
				await refreshApiKeys();
			} else {
				toast.error(res.error ?? "Failed to save configuration");
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to save config");
		}
	}, [customOpenAiInputs, customOpenAiConfig.hasApiKey, refreshApiKeys]);

	// Save an API key securely via Electron safeStorage
	const handleSaveApiKey = useCallback(
		async (provider: "fish-audio" | "acedatacloud" | "openai" | "deepl", key: string) => {
			if (!window.electronAPI?.saveDubbingApiKey) return;
			const trimmed = key.trim();
			if (!trimmed) {
				toast.error("Please enter a valid API key");
				return;
			}
			try {
				const result = await window.electronAPI.saveDubbingApiKey({
					provider,
					key: trimmed,
				});
				if (result.success) {
					toast.success(`Saved API key for ${provider}`);
					setApiKeyInputs((prev) => ({ ...prev, [provider]: "" }));
					await refreshApiKeys();
				} else {
					toast.error(result.error ?? "Failed to save API key");
				}
			} catch (err) {
				toast.error(err instanceof Error ? err.message : "Failed to save API key");
			}
		},
		[refreshApiKeys],
	);

	// Check model status for a given quantization
	const checkModelStatus = useCallback(async (quant: DubbingModelQuantization) => {
		if (!window.electronAPI?.getTranslationModelStatus) return;
		try {
			const res = await window.electronAPI.getTranslationModelStatus(quant);
			if (res.success) {
				setModelStatusByQuantization((prev) => ({
					...prev,
					[quant]: {
						exists: Boolean(res.exists),
						path: res.path ?? null,
						isDownloading: false,
						progress: res.exists ? 100 : 0,
					},
				}));
			}
		} catch (err) {
			console.error(`[useDubbingController] Failed checking status for ${quant}:`, err);
		}
	}, []);

	// Check TTS model status for a given quantization
	const checkTtsModelStatus = useCallback(async (quant: TtsQuantization) => {
		if (!window.electronAPI?.getTtsModelStatus) return;
		try {
			const res = await window.electronAPI.getTtsModelStatus(quant);
			if (res.success) {
				setTtsModelStatusByQuantization((prev) => ({
					...prev,
					[quant]: {
						exists: Boolean(res.exists),
						path: res.path ?? null,
						isDownloading: false,
						progress: res.exists ? 100 : 0,
					},
				}));
			}
		} catch (err) {
			console.error(`[useDubbingController] Failed checking TTS model status for ${quant}:`, err);
		}
	}, []);

	// Download Fish Audio S2-Pro TTS model
	const handleDownloadTtsModel = useCallback(async (quant: TtsQuantization) => {
		if (!window.electronAPI?.downloadTtsModel) return;
		setTtsModelStatusByQuantization((prev) => ({
			...prev,
			[quant]: { ...prev[quant], isDownloading: true, progress: 0, error: undefined },
		}));
		try {
			const res = await window.electronAPI.downloadTtsModel(quant);
			if (!res.success) {
				setTtsModelStatusByQuantization((prev) => ({
					...prev,
					[quant]: { ...prev[quant], isDownloading: false, error: res.error },
				}));
				toast.error(res.error ?? `Failed to download ${quant.toUpperCase()} weights`);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : "TTS Download failed";
			setTtsModelStatusByQuantization((prev) => ({
				...prev,
				[quant]: { ...prev[quant], isDownloading: false, error: msg },
			}));
			toast.error(msg);
		}
	}, []);

	// Cancel Fish Audio S2-Pro TTS model download
	const handleCancelTtsModelDownload = useCallback(async () => {
		if (!window.electronAPI?.cancelTtsModelDownload) return;
		try {
			const res = await window.electronAPI.cancelTtsModelDownload();
			if (res.success) {
				setTtsModelStatusByQuantization((prev) => {
					const updated = { ...prev };
					for (const key of Object.keys(updated) as TtsQuantization[]) {
						if (updated[key]?.isDownloading) {
							updated[key] = {
								...updated[key],
								isDownloading: false,
								progress: 0,
								speed: undefined,
								eta: undefined,
							};
						}
					}
					return updated;
				});
				toast.info("Model download canceled");
			}
		} catch (err) {
			console.error("[useDubbingController] Failed to cancel TTS model download:", err);
		}
	}, []);

	// Download model for a specific quantization
	const handleDownloadModel = useCallback(async (quant: DubbingModelQuantization) => {
		if (!window.electronAPI?.downloadTranslationModel) return;
		setModelStatusByQuantization((prev) => ({
			...prev,
			[quant]: { ...prev[quant], isDownloading: true, progress: 0, error: undefined },
		}));
		try {
			const res = await window.electronAPI.downloadTranslationModel(quant);
			if (!res.success) {
				setModelStatusByQuantization((prev) => ({
					...prev,
					[quant]: { ...prev[quant], isDownloading: false, error: res.error },
				}));
				toast.error(res.error ?? `Failed to download ${quant.toUpperCase()} model`);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Download failed";
			setModelStatusByQuantization((prev) => ({
				...prev,
				[quant]: { ...prev[quant], isDownloading: false, error: msg },
			}));
			toast.error(msg);
		}
	}, []);

	// Delete translation model
	const handleDeleteTranslationModel = useCallback(
		async (quant?: DubbingModelQuantization) => {
			const targetQuant = quant ?? translationQuantization;
			if (!window.electronAPI?.deleteTranslationModel) return;
			try {
				const res = await window.electronAPI.deleteTranslationModel(targetQuant);
				if (res.success) {
					setModelStatusByQuantization((prev) => ({
						...prev,
						[targetQuant]: {
							exists: false,
							isDownloading: false,
							progress: 0,
							path: null,
						},
					}));
					toast.success(`${targetQuant.toUpperCase()} translation model deleted`);
				} else {
					toast.error(res.error ?? `Failed to delete ${targetQuant.toUpperCase()} model`);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Failed to delete translation model";
				toast.error(msg);
			}
		},
		[translationQuantization],
	);

	// Delete Fish Audio TTS model
	const handleDeleteTtsModel = useCallback(
		async (quant?: TtsQuantization) => {
			const targetQuant = quant ?? ttsQuantization;
			if (!window.electronAPI?.deleteTtsModel) return;
			try {
				const res = await window.electronAPI.deleteTtsModel(targetQuant);
				if (res.success) {
					setTtsModelStatusByQuantization((prev) => ({
						...prev,
						[targetQuant]: {
							exists: false,
							isDownloading: false,
							progress: 0,
							path: null,
							downloadedBytes: 0,
						},
					}));
					toast.success(`${targetQuant.toUpperCase()} voice model deleted`);
				} else {
					toast.error(res.error ?? `Failed to delete ${targetQuant.toUpperCase()} voice model`);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Failed to delete voice model";
				toast.error(msg);
			}
		},
		[ttsQuantization],
	);

	// Extract reference voice sample from current recording (timeline slice)
	const handleExtractReference = useCallback(async () => {
		if (!videoPath) {
			toast.error("No active video source to extract reference voice from");
			return;
		}
		if (!window.electronAPI?.extractVoiceReference) {
			toast.error("Voice extraction is not supported on this platform");
			return;
		}

		setIsExtractingReference(true);
		try {
			// Find an ideal speech segment from existing cues (prefer between 5s and 10s)
			let startMs = 0;
			let durationMs = 8000;

			if (cues.length > 0) {
				const firstCue = cues[0];
				startMs = Math.max(0, firstCue.startMs);
				durationMs = Math.min(10000, Math.max(4000, cues[cues.length - 1].endMs - startMs));
			}

			const res = await window.electronAPI.extractVoiceReference({
				videoPath,
				startMs,
				durationMs,
				existingCues: cues,
			});

			if (res.success && res.referenceAudioPath) {
				setReferenceAudioPath(res.referenceAudioPath);
				setReferenceDurationSec(res.durationMs ? res.durationMs / 1000 : 0);
				setReferenceTranscript(res.suggestedTranscript ?? "");
				setVoiceSourceType("timeline");
				toast.success("Voice sample extracted successfully");
			} else {
				toast.error(res.error ?? "Failed to extract voice sample");
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Error extracting voice sample");
		} finally {
			setIsExtractingReference(false);
		}
	}, [videoPath, cues]);

	// Upload external audio file for voice reference
	const handleUploadReference = useCallback(async (filePath?: string) => {
		if (!window.electronAPI?.importVoiceReferenceFile) {
			toast.error("File import is not supported on this platform");
			return;
		}

		setIsUploadingReference(true);
		try {
			const res = await window.electronAPI.importVoiceReferenceFile({
				filePath,
				whisperExecutablePath: whisperExecutablePath ?? undefined,
				whisperModelPath: whisperModelPath ?? undefined,
			});

			if (res.canceled) {
				return;
			}

			if (res.success && res.referenceAudioPath) {
				setReferenceAudioPath(res.referenceAudioPath);
				setReferenceDurationSec(res.durationMs ? res.durationMs / 1000 : 0);
				setReferenceTranscript(res.suggestedTranscript ?? "");
				setVoiceSourceType("upload");
				if (res.suggestedTranscript) {
					toast.success("Voice sample imported successfully");
				} else {
					toast.success("Voice sample imported. You can type the transcript below.");
				}
			} else {
				toast.error(res.error ?? "Failed to import voice sample");
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Error importing voice sample");
		} finally {
			setIsUploadingReference(false);
		}
	}, [whisperExecutablePath, whisperModelPath]);

	// Save live recorded microphone sample
	const handleSaveLiveRecord = useCallback(
		async (buffer: Uint8Array, mimeType: string, promptText?: string) => {
			if (!window.electronAPI?.saveLiveVoiceReference) {
				toast.error("Live voice recording is not supported on this platform");
				return;
			}

			setIsSavingLiveReference(true);
			try {
				const res = await window.electronAPI.saveLiveVoiceReference({
					audioBuffer: buffer,
					mimeType,
					promptText,
					whisperExecutablePath: whisperExecutablePath ?? undefined,
					whisperModelPath: whisperModelPath ?? undefined,
				});

				if (res.success && res.referenceAudioPath) {
					setReferenceAudioPath(res.referenceAudioPath);
					setReferenceDurationSec(res.durationMs ? res.durationMs / 1000 : 0);
					setReferenceTranscript(res.suggestedTranscript ?? "");
					setVoiceSourceType("record");
					if (res.suggestedTranscript) {
						toast.success("Voice sample recorded successfully");
					} else {
						toast.success("Voice sample recorded. You can type the transcript below.");
					}
				} else {
					toast.error(res.error ?? "Failed to save recorded voice sample");
				}
			} catch (err) {
				toast.error(err instanceof Error ? err.message : "Error saving voice recording");
			} finally {
				setIsSavingLiveReference(false);
			}
		},
		[whisperExecutablePath, whisperModelPath],
	);

	// Re-transcribe current reference audio sample with Whisper
	const handleRetranscribeReference = useCallback(async () => {
		if (!referenceAudioPath) {
			toast.error("No reference audio sample to transcribe");
			return;
		}
		if (!window.electronAPI?.transcribeAudioSample) {
			toast.error("Transcription is not supported on this platform");
			return;
		}

		setIsTranscribingReference(true);
		try {
			const res = await window.electronAPI.transcribeAudioSample({
				audioPath: referenceAudioPath,
				whisperExecutablePath: whisperExecutablePath ?? undefined,
				whisperModelPath: whisperModelPath ?? undefined,
			});

			if (res.success && res.transcript) {
				setReferenceTranscript(res.transcript);
				toast.success("Voice sample transcript updated");
			} else if (res.modelMissing) {
				toast.info(res.error ?? "Whisper model not downloaded. You can enter the transcript manually.");
			} else {
				toast.error(res.error ?? "Could not transcribe audio sample");
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Error transcribing audio sample");
		} finally {
			setIsTranscribingReference(false);
		}
	}, [referenceAudioPath, whisperExecutablePath, whisperModelPath]);

	// Clear reference voice sample
	const handleClearReference = useCallback(() => {
		setReferenceAudioPath(null);
		setReferenceDurationSec(0);
		setReferenceTranscript("");
		setVoiceSourceType(null);
	}, []);

	// Initial checks on mount
	useEffect(() => {
		void refreshApiKeys();
		void checkModelStatus("int8");
		void checkModelStatus("fp16");
		void checkModelStatus("fp32");
		void checkTtsModelStatus("q4_k_m");
		void checkTtsModelStatus("q5_k_m");
		void checkTtsModelStatus("q6_k");
		void checkTtsModelStatus("q8_0");
		void checkTtsModelStatus("f16");
	}, [refreshApiKeys, checkModelStatus, checkTtsModelStatus]);

	// Listen to TTS download progress
	useEffect(() => {
		if (!window.electronAPI?.onTtsModelDownloadProgress) return;
		const unsubscribe = window.electronAPI.onTtsModelDownloadProgress((state) => {
			const quant = state.quantization;
			if (!quant) return;
			setTtsModelStatusByQuantization((prev) => ({
				...prev,
				[quant]: {
					exists: state.status === "downloaded",
					path: state.path ?? null,
					isDownloading: state.status === "downloading",
					progress: state.progress,
					downloadedBytes: state.downloadedBytes,
					totalBytes: state.totalBytes,
					speed: state.speed,
					eta: state.eta,
					error: state.error,
				},
			}));

			if (state.status === "downloaded") {
				toast.success(`Fish Audio S2-Pro (${quant.toUpperCase()}) downloaded successfully`);
			} else if (state.status === "error" && state.error) {
				toast.error(state.error);
			}
		});

		return () => {
			unsubscribe();
		};
	}, []);

	// Listen to download progress
	useEffect(() => {
		if (!window.electronAPI?.onTranslationModelDownloadProgress) return;
		const unsubscribe = window.electronAPI.onTranslationModelDownloadProgress((state) => {
			const quant = state.quantization;
			if (!quant) return;
			setModelStatusByQuantization((prev) => ({
				...prev,
				[quant]: {
					exists: state.status === "downloaded",
					path: state.path ?? null,
					isDownloading: state.status === "downloading",
					progress: state.progress,
					error: state.error,
				},
			}));

			if (state.status === "downloaded") {
				toast.success(`NLLB model (${quant.toUpperCase()}) downloaded successfully`);
			} else if (state.status === "error" && state.error) {
				toast.error(state.error);
			}
		});

		return () => {
			unsubscribe();
		};
	}, []);

	// Listen to segment synthesis progress
	useEffect(() => {
		if (!window.electronAPI?.onDubbingSegmentProgress) return;
		const unsubscribe = window.electronAPI.onDubbingSegmentProgress((payload) => {
			setGenerationProgress(payload.percent);
			if (payload.stage === "synthesizing") {
				setGenerationStage("synthesizing");
				setSegmentCueProgress({
					current: payload.currentCue,
					total: payload.totalCues,
				});
			} else if (payload.stage === "fitting") {
				setGenerationStage("aligning");
			} else if (payload.stage === "assembling") {
				setGenerationStage("finalizing");
			} else if (payload.stage === "ready") {
				setGenerationStage("ready");
				setSegmentCueProgress(null);
			}
		});

		return () => {
			unsubscribe();
		};
	}, []);

	// Cancel Dubbing Pipeline Execution
	const handleCancelDubbing = useCallback(async () => {
		try {
			await window.electronAPI?.cancelDubbingSynthesis?.();
		} catch (err) {
			console.warn("Failed to cancel dubbing synthesis:", err);
		}
		setGenerationStage("idle");
		setGenerationProgress(0);
		setGenerationError(null);
		setSegmentCueProgress(null);
		toast.info("Dubbing generation canceled");
	}, []);

	// Main Dubbing Pipeline Execution
	const handleGenerateDubbing = useCallback(async () => {
		if (!videoPath) {
			toast.error("Please load a video first");
			return;
		}

		if (cues.length === 0) {
			toast.error("No captions or transcripts available. Please transcribe the video first.");
			return;
		}

		setGenerationError(null);
		setGenerationStage("extracting-ref");
		setGenerationProgress(5);

		try {
			// 1. Ensure reference voice sample exists
			let currentRefPath = referenceAudioPath;
			let currentRefTranscript = referenceTranscript.trim();

			if (!currentRefPath) {
				toast.info("Extracting voice sample from current recording...");
				const refRes = await window.electronAPI.extractVoiceReference({
					videoPath,
					startMs: cues[0]?.startMs ?? 0,
					durationMs: 8000,
					existingCues: cues,
				});

				if (!refRes.success || !refRes.referenceAudioPath) {
					throw new Error(refRes.error ?? "Failed to extract voice reference sample");
				}

				currentRefPath = refRes.referenceAudioPath;
				currentRefTranscript = refRes.suggestedTranscript ?? "";
				setReferenceAudioPath(currentRefPath);
				setReferenceTranscript(currentRefTranscript);
				setReferenceDurationSec(refRes.durationMs ? refRes.durationMs / 1000 : 0);
			}

			// If transcript is still empty, use the first caption cue text as fallback
			if (!currentRefTranscript && cues.length > 0) {
				currentRefTranscript = cues[0].text.trim();
			}

			// Stage 1: Translating Captions... (0% – 25%)
			setGenerationStage("translating");
			setGenerationProgress(15);

			const textCues = cues.map((cue) => ({
				id: cue.id,
				text: cue.text,
			}));

			const translateRes = await window.electronAPI.translateTranscript({
				textCues,
				targetLang: targetLanguage,
				engine: translationEngine,
				quantization: translationQuantization,
				apiProvider: apiTranslationProvider,
				customOpenAiConfig:
					apiTranslationProvider === "openai"
						? {
								baseUrl: customOpenAiConfig.baseUrl || undefined,
								model: customOpenAiConfig.model || undefined,
							}
						: undefined,
			});

			if (!translateRes.success || !translateRes.translatedCues) {
				throw new Error(translateRes.error ?? "Translation failed");
			}

			const translatedCues = translateRes.translatedCues;
			setGenerationProgress(25);

			// Stage 2: Segment-Anchored Audio Synthesis (25% – 95%)
			setGenerationStage("synthesizing");
			setGenerationProgress(28);

			const totalDurationMs =
				duration && duration > 0
					? Math.round(duration * 1000)
					: cues[cues.length - 1]?.endMs ?? 0;

			const segmentCues = translatedCues.map((tc, idx) => ({
				id: tc.id || cues[idx]?.id || `cue-${idx}`,
				text: tc.text,
				startMs: cues[idx]?.startMs ?? idx * 2000,
				endMs: cues[idx]?.endMs ?? (idx + 1) * 2000,
			}));

			const synthRes = await window.electronAPI.synthesizeDubbedSegments({
				cues: segmentCues,
				referenceAudioPath: currentRefPath,
				referenceTranscript: currentRefTranscript,
				backend: ttsBackend,
				provider: cloudProvider,
				quantization: ttsQuantization,
				targetLanguage,
				totalDurationMs,
			});

			if (!synthRes.success || !synthRes.dubbedAudioPath) {
				if (synthRes.canceled) {
					return;
				}
				throw new Error(synthRes.error ?? "Segment audio synthesis failed");
			}

			const synthAudioPath = synthRes.dubbedAudioPath;
			const synthDurationSec = synthRes.durationMs
				? synthRes.durationMs / 1000
				: duration;

			// Stage 3: Direct Caption Synchronization (1:1 with Original Cue Timing)
			setGenerationStage("aligning");
			setGenerationProgress(95);

			const dubbedCaptions: CaptionCue[] = translatedCues.map((tc, idx) => ({
				id: tc.id ?? `dubcue-${idx}`,
				startMs: cues[idx]?.startMs ?? idx * 2000,
				endMs: cues[idx]?.endMs ?? (idx + 1) * 2000,
				text: tc.text,
			}));

			const alignedCues: DubbingSyncedCaptionCue[] = dubbedCaptions.map((c) => ({
				id: c.id,
				start: c.startMs / 1000,
				end: c.endMs / 1000,
				startMs: c.startMs,
				endMs: c.endMs,
				text: c.text,
			}));

			// Stage 4: Finalizing Track... (98% – 100%)
			setGenerationStage("finalizing");
			setGenerationProgress(98);

			// Build and set DubbingTrack on timeline with original captions preserved
			const newDubbingTrack: DubbingTrack = {
				id: `dubbing-${Date.now()}`,
				targetLanguage,
				language: targetLanguage,
				dubbedAudioPath: synthAudioPath,
				audioPath: synthAudioPath,
				referenceVoiceSamplePath: currentRefPath,
				referenceTranscript: currentRefTranscript,
				volume: dubbingTrack?.volume ?? 1,
				isActive: true,
				durationSec: synthDurationSec,
				syncedCaptions: alignedCues,
				syncedCues: alignedCues,
				originalCaptions: cues,
			};

			setDubbingTrack(newDubbingTrack);

			// Automatically swap timeline subtitles to translated target language
			if (setAutoCaptions) {
				setAutoCaptions(dubbedCaptions);
			}

			setGenerationStage("ready");
			setGenerationProgress(100);
			setSegmentCueProgress(null);
			toast.success("AI Dubbing generated and synced to timeline!");
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Dubbing generation failed";
			setGenerationStage("error");
			setGenerationError(msg);
			setSegmentCueProgress(null);
			toast.error(msg);
		}
	}, [
		videoPath,
		cues,
		duration,
		referenceAudioPath,
		referenceTranscript,
		targetLanguage,
		translationEngine,
		translationQuantization,
		apiTranslationProvider,
		ttsBackend,
		cloudProvider,
		ttsQuantization,
		whisperExecutablePath,
		whisperModelPath,
		dubbingTrack,
		setDubbingTrack,
		setAutoCaptions,
		customOpenAiConfig,
	]);

	// Audio Track Toggle Controls
	const handleToggleActiveTrack = useCallback(() => {
		setDubbingTrack((current) => {
			if (!current) return null;
			const nextActive = !current.isActive;
			if (setAutoCaptions) {
				if (nextActive) {
					const dubbed = current.syncedCaptions ?? current.syncedCues ?? [];
					if (dubbed.length > 0) {
						setAutoCaptions(
							dubbed.map((c, idx) => ({
								id: c.id ?? `dubcue-${idx}`,
								startMs: c.startMs ?? Math.round(c.start * 1000),
								endMs: c.endMs ?? Math.round(c.end * 1000),
								text: c.text,
							})),
						);
					}
				} else {
					if (current.originalCaptions && current.originalCaptions.length > 0) {
						setAutoCaptions(current.originalCaptions);
					}
				}
			}
			return { ...current, isActive: nextActive };
		});
	}, [setDubbingTrack, setAutoCaptions]);

	const handleSetVolume = useCallback(
		(volume: number) => {
			setDubbingTrack((current) => {
				if (!current) return null;
				return { ...current, volume: Math.max(0, Math.min(2, volume)) };
			});
		},
		[setDubbingTrack],
	);

	const handleRemoveDubbedTrack = useCallback(() => {
		if (
			setAutoCaptions &&
			dubbingTrack?.originalCaptions &&
			dubbingTrack.originalCaptions.length > 0
		) {
			setAutoCaptions(dubbingTrack.originalCaptions);
		}
		setDubbingTrack(null);
		setGenerationStage("idle");
		setGenerationProgress(0);
		toast.info("Dubbed track removed from timeline");
	}, [dubbingTrack, setDubbingTrack, setAutoCaptions]);

	return {
		// Preferences & Configurations
		targetLanguage,
		updateTargetLanguage,
		ttsBackend,
		updateTtsBackend,
		cloudProvider,
		updateCloudProvider,
		translationEngine,
		updateTranslationEngine,
		translationQuantization,
		updateTranslationQuantization,
		apiTranslationProvider,
		updateApiTranslationProvider,

		// API Keys & Custom API Endpoints
		savedApiKeys,
		apiKeyInputs,
		setApiKeyInputs,
		handleSaveApiKey,
		customOpenAiConfig,
		customOpenAiInputs,
		setCustomOpenAiInputs,
		handleSaveCustomOpenAiConfig,

		// Local Quantized Models
		modelStatusByQuantization,
		handleDownloadModel,
		handleDeleteTranslationModel,
		checkModelStatus,

		// Fish Audio S2-Pro Local Engine
		ttsQuantization,
		updateTtsQuantization,
		ttsModelStatusByQuantization,
		handleDownloadTtsModel,
		handleDeleteTtsModel,
		handleCancelTtsModelDownload,
		checkTtsModelStatus,

		// Voice Sample
		voiceSourceMode,
		setVoiceSourceMode,
		voiceSourceType,
		referenceAudioPath,
		referenceDurationSec,
		referenceTranscript,
		setReferenceTranscript,
		isExtractingReference,
		isUploadingReference,
		isSavingLiveReference,
		isTranscribingReference,
		handleExtractReference,
		handleUploadReference,
		handleSaveLiveRecord,
		handleRetranscribeReference,
		handleClearReference,

		// Pipeline Generation
		generationStage,
		generationProgress,
		generationError,
		segmentCueProgress,
		handleGenerateDubbing,
		handleCancelDubbing,

		// Playback & Track Controls
		dubbingTrack,
		handleToggleActiveTrack,
		handleSetVolume,
		handleRemoveDubbedTrack,
	};
}
