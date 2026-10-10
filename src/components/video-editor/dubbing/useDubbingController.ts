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
	whisperExecutablePath?: string | null;
	whisperModelPath?: string | null;
}

export type DubbingGenerationStage =
	| "idle"
	| "extracting-ref"
	| "translating"
	| "synthesizing"
	| "aligning"
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
				toast.success("Voice sample imported successfully");
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
					toast.success("Voice sample recorded successfully");
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
		setGenerationProgress(10);

		try {
			// 1. Ensure reference voice sample exists
			let currentRefPath = referenceAudioPath;
			let currentRefTranscript = referenceTranscript.trim();

			if (!currentRefPath || !currentRefTranscript) {
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

			// 2. Translate transcript to target language
			setGenerationStage("translating");
			setGenerationProgress(30);

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
			const fullTranslatedText = translatedCues.map((c) => c.text).join(" ");

			// 3. Synthesize Dubbed Audio (Fish Audio S2-Pro Zero-Shot Voice Cloning)
			setGenerationStage("synthesizing");
			setGenerationProgress(65);

			let synthAudioPath: string | undefined;
			let synthDurationSec: number | undefined;

			if (ttsBackend === "cloud") {
				const synthRes = await window.electronAPI.synthesizeDubbedAudioApi({
					text: fullTranslatedText,
					referenceAudioPath: currentRefPath,
					referenceTranscript: currentRefTranscript,
					provider: cloudProvider,
					targetLanguage,
				});

				if (!synthRes.success || !synthRes.dubbedAudioPath) {
					throw new Error(synthRes.error ?? "Cloud voice synthesis failed");
				}
				synthAudioPath = synthRes.dubbedAudioPath;
				synthDurationSec = synthRes.durationMs ? synthRes.durationMs / 1000 : undefined;
			} else {
				const synthRes = await window.electronAPI.synthesizeDubbedAudioLocal({
					text: fullTranslatedText,
					referenceAudioPath: currentRefPath,
					referenceTranscript: currentRefTranscript,
					targetLanguage,
					quantization: ttsQuantization,
				});

				if (!synthRes.success || !synthRes.dubbedAudioPath) {
					throw new Error(synthRes.error ?? "Local voice synthesis failed");
				}
				synthAudioPath = synthRes.dubbedAudioPath;
				synthDurationSec = synthRes.durationMs ? synthRes.durationMs / 1000 : undefined;
			}

			// 4. Align Captions with Synthesized Audio
			setGenerationStage("aligning");
			setGenerationProgress(85);

			let alignedCues: DubbingSyncedCaptionCue[] = [];
			if (synthAudioPath) {
				try {
					const alignRes = await window.electronAPI.alignDubbedCaptions({
						dubbedAudioPath: synthAudioPath,
						targetLanguage,
						whisperExecutablePath: whisperExecutablePath ?? undefined,
						whisperModelPath: whisperModelPath ?? undefined,
					});

					if (alignRes.success && alignRes.cues) {
						alignedCues = alignRes.cues.map((c) => ({
							id: c.id,
							start: c.startMs / 1000,
							end: c.endMs / 1000,
							startMs: c.startMs,
							endMs: c.endMs,
							text: c.text,
						}));
					}
				} catch (alignErr) {
					console.warn("[useDubbingController] Auto-alignment warning:", alignErr);
				}
			}

			// If alignment had no cues, fallback to scaled timing from original cues
			if (alignedCues.length === 0 && synthDurationSec) {
				const originalDurationMs = cues[cues.length - 1]?.endMs ?? 1000;
				const scaleRatio = (synthDurationSec * 1000) / originalDurationMs;
				alignedCues = translatedCues.map((tc, idx) => {
					const orig = cues[idx];
					const sMs = orig ? Math.round(orig.startMs * scaleRatio) : idx * 2000;
					const eMs = orig ? Math.round(orig.endMs * scaleRatio) : (idx + 1) * 2000;
					return {
						id: `dubcue-${idx}`,
						start: sMs / 1000,
						end: eMs / 1000,
						startMs: sMs,
						endMs: eMs,
						text: tc.text,
					};
				});
			}

			// 5. Build and set DubbingTrack on timeline
			const newDubbingTrack: DubbingTrack = {
				id: `dubbing-${Date.now()}`,
				targetLanguage,
				language: targetLanguage,
				dubbedAudioPath: synthAudioPath ?? "",
				audioPath: synthAudioPath ?? "",
				volume: dubbingTrack?.volume ?? 1,
				isActive: true,
				durationSec: synthDurationSec,
				syncedCaptions: alignedCues,
				syncedCues: alignedCues,
			};

			setDubbingTrack(newDubbingTrack);
			setGenerationStage("ready");
			setGenerationProgress(100);
			toast.success("AI Dubbing generated and synced to timeline!");
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Dubbing generation failed";
			setGenerationStage("error");
			setGenerationError(msg);
			toast.error(msg);
		}
	}, [
		videoPath,
		cues,
		referenceAudioPath,
		referenceTranscript,
		targetLanguage,
		translationEngine,
		translationQuantization,
		apiTranslationProvider,
		ttsBackend,
		cloudProvider,
		whisperExecutablePath,
		whisperModelPath,
		dubbingTrack,
		setDubbingTrack,
	]);

	// Audio Track Toggle Controls
	const handleToggleActiveTrack = useCallback(() => {
		setDubbingTrack((current) => {
			if (!current) return null;
			return { ...current, isActive: !current.isActive };
		});
	}, [setDubbingTrack]);

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
		setDubbingTrack(null);
		setGenerationStage("idle");
		setGenerationProgress(0);
	}, [setDubbingTrack]);

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
		checkModelStatus,

		// Fish Audio S2-Pro Local Engine
		ttsQuantization,
		updateTtsQuantization,
		ttsModelStatusByQuantization,
		handleDownloadTtsModel,
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
		handleGenerateDubbing,

		// Playback & Track Controls
		dubbingTrack,
		handleToggleActiveTrack,
		handleSetVolume,
		handleRemoveDubbedTrack,
	};
}
