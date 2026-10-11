import { Button, Card, Label, ProgressBar } from "@heroui/react";
import { useEffect, useState } from "react";
import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
import {
	ArrowClockwise,
	MicrophoneIcon,
	Scissors,
	Trash,
	UploadSimple,
} from "@/components/ui/icons";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { resolveVideoUrl } from "../projectPersistence";
import { SliderControl } from "../SliderControl";
import type {
	DubbingApiTranslationProvider,
	DubbingCloudProvider,
	DubbingTranslationEngine,
	DubbingTtsBackend,
} from "../types";
import {
	QUANTIZATION_OPTIONS,
	SUPPORTED_DUBBING_LANGUAGES,
	TTS_QUANTIZATION_OPTIONS,
} from "./constants";
import type { useDubbingController } from "./useDubbingController";
import { useVoiceRecorder } from "./useVoiceRecorder";

function formatBytes(bytes: number): string {
	if (!bytes || bytes <= 0) return "0 MB";
	if (bytes >= 1_000_000_000) {
		return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
	}
	return `${(bytes / 1_000_000).toFixed(0)} MB`;
}

const DEFAULT_PROMPT_SCRIPT =
	"Recordly makes screen recording effortless and professional. I am recording this clear voice sample to clone my voice for multi-language dubbing.";

interface DubbingPanelProps {
	controller: ReturnType<typeof useDubbingController>;
	advanced?: boolean;
	t?: (key: string, fallback?: string) => string;
}

export function DubbingPanel({
	controller,
	advanced: _advanced = false,
	t: _t,
}: DubbingPanelProps) {
	const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
	const [isSwitchingTranslationQuant, setIsSwitchingTranslationQuant] = useState(false);
	const [isSwitchingTtsQuant, setIsSwitchingTtsQuant] = useState(false);
	const [apiKeyTempInputs, setApiKeyTempInputs] = useState<Record<string, string>>({
		"fish-audio": "",
		acedatacloud: "",
		openai: "",
		deepl: "",
	});

	const {
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
		savedApiKeys,
		handleSaveApiKey,
		modelStatusByQuantization,
		handleDownloadModel,
		handleDeleteTranslationModel,
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
		generationStage,
		generationProgress,
		generationError,
		handleGenerateDubbing,
		handleCancelDubbing,
		segmentCueProgress,
		dubbingTrack,
		handleToggleActiveTrack,
		handleSetVolume,
		handleRemoveDubbedTrack,
		handleDownloadTtsModel,
		handleDeleteTtsModel,
		handleCancelTtsModelDownload,
	} = controller;

	const voiceRecorder = useVoiceRecorder({
		maxDurationSec: 8,
		onComplete: (buffer, mime) => {
			void handleSaveLiveRecord(buffer, mime, DEFAULT_PROMPT_SCRIPT);
		},
	});

	const selectedQuantStatus = modelStatusByQuantization[translationQuantization];
	const isGenerating =
		generationStage !== "idle" && generationStage !== "ready" && generationStage !== "error";

	const selectedLangObj = SUPPORTED_DUBBING_LANGUAGES.find((l) => l.code === targetLanguage);
	const targetLangName = selectedLangObj?.name ?? targetLanguage.toUpperCase();

	const generationStageText = (() => {
		if (generationStage === "extracting-ref") {
			return "Extracting voice reference...";
		}
		if (generationStage === "translating") {
			return `Translating speech to ${targetLangName}...`;
		}
		if (generationStage === "synthesizing") {
			if (segmentCueProgress && segmentCueProgress.total > 0) {
				return `Cloning your voice in ${targetLangName} (Cue ${segmentCueProgress.current} of ${segmentCueProgress.total})...`;
			}
			return `Cloning your voice in ${targetLangName}...`;
		}
		if (generationStage === "aligning") {
			return "Matching voice timing to video...";
		}
		if (generationStage === "finalizing") {
			return "Finishing dubbed audio track...";
		}
		return "Dubbing in progress...";
	})();

	useEffect(() => {
		let isMounted = true;
		if (referenceAudioPath) {
			resolveVideoUrl(referenceAudioPath)
				.then((url) => {
					if (isMounted) setAudioPreviewUrl(url);
				})
				.catch((err) => {
					console.error("[DubbingPanel] Failed to resolve audio preview url:", err);
				});
		} else {
			setAudioPreviewUrl(null);
		}
		return () => {
			isMounted = false;
		};
	}, [referenceAudioPath]);

	return (
		<div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1.5 custom-scrollbar flex flex-col gap-5 py-1">
			{/* Active Track Status (if dubbed track exists) */}
			{dubbingTrack && (
				<Card className="border border-primary/20 bg-primary/5 p-3.5 rounded-xl flex flex-col gap-3">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<span
								className={cn(
									"flex size-2 rounded-full",
									dubbingTrack.isActive
										? "bg-emerald-500 animate-pulse"
										: "bg-muted-foreground",
								)}
							/>
							<span className="text-xs font-semibold uppercase tracking-wider text-primary">
								Dubbed Audio Track
							</span>
							<span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary uppercase border border-primary/20">
								{dubbingTrack.language ?? dubbingTrack.targetLanguage}
							</span>
						</div>
						<div className="flex items-center gap-2">
							<Switch
								id="toggle-active-dub-track"
								checked={dubbingTrack.isActive}
								onCheckedChange={handleToggleActiveTrack}
								aria-label="Toggle dubbed audio track"
							/>
						</div>
					</div>

					<p className="text-[11px] text-muted-foreground leading-relaxed">
						{dubbingTrack.isActive
							? "Dubbed audio is active and synchronized to timeline."
							: "Original audio active. Dubbed track muted."}
					</p>

					<div className="pt-1">
						<SliderControl
							label="Dubbed Volume"
							value={Math.round((dubbingTrack.volume ?? 1) * 100)}
							min={0}
							max={100}
							step={1}
							onChange={(val) => handleSetVolume(val / 100)}
							formatValue={(val) => `${Math.round(val)}%`}
						/>
					</div>

					<div className="flex items-center justify-between pt-1 border-t border-border/40">
						<span className="text-[11px] text-muted-foreground font-medium">
							{(dubbingTrack.syncedCaptions ?? dubbingTrack.syncedCues ?? []).length}{" "}
							time-synced cues
						</span>
						<Button
							size="sm"
							variant="ghost"
							className="h-7 text-[11px] text-destructive hover:bg-destructive/10 px-2 rounded-md transition-colors"
							onPress={handleRemoveDubbedTrack}
						>
							Remove Dubbing
						</Button>
					</div>
				</Card>
			)}

			{/* Target Language Selection */}
			<section className="flex flex-col gap-2">
				<Label className="text-[13px] font-medium">Target Language</Label>
				<Select value={targetLanguage} onValueChange={(val) => updateTargetLanguage(val)}>
					<SelectTrigger className="w-full h-9 text-xs">
						<SelectValue placeholder="Select target language" />
					</SelectTrigger>
					<SelectContent className="max-h-64">
						{SUPPORTED_DUBBING_LANGUAGES.map((lang) => (
							<SelectItem key={lang.code} value={lang.code} className="text-xs">
								{lang.name} ({lang.nativeName})
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</section>

			{/* Creator Voice Sample (3-Way: Timeline Slice, Upload Audio, Live Quick Record) */}
			<section className="flex flex-col gap-2.5">
				<div className="flex items-center justify-between">
					<Label className="text-[13px] font-medium">Creator Voice Sample</Label>
					<span className="text-[11px] text-muted-foreground">
						Zero-shot cloning (5-10s)
					</span>
				</div>

				{referenceAudioPath ? (
					<div className="rounded-xl border border-border bg-card/50 p-3 flex flex-col gap-2.5">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<span className="text-[11px] text-emerald-500 font-medium flex items-center gap-1.5">
									<span className="size-1.5 rounded-full bg-emerald-500" />
									Sample Ready (
									{referenceDurationSec
										? `${referenceDurationSec.toFixed(1)}s`
										: "Ready"}
									)
								</span>
								<span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground font-normal">
									{voiceSourceType === "timeline"
										? "From Recording"
										: voiceSourceType === "upload"
											? "Uploaded File"
											: voiceSourceType === "record"
												? "Quick Record"
												: "Voice Reference"}
								</span>
							</div>
							<Button
								size="sm"
								variant="ghost"
								className="h-6 text-[10px] text-destructive hover:bg-destructive/10 gap-1 px-2"
								onPress={handleClearReference}
							>
								<Trash className="size-3" />
								Replace
							</Button>
						</div>

						<audio
							controls
							src={audioPreviewUrl ?? undefined}
							className="w-full h-7 mt-0.5 rounded"
						/>

						<div className="flex flex-col gap-1 mt-1">
							<div className="flex items-center justify-between">
								<Label className="text-[11px] text-muted-foreground">
									Reference Transcript{" "}
									<span className="text-amber-500 text-[10px]">
										(must match audio verbatim)
									</span>
								</Label>
								<span className="text-[10px] text-muted-foreground font-mono">
									{referenceTranscript.length} chars
								</span>
							</div>
							<textarea
								value={referenceTranscript}
								onChange={(e) => setReferenceTranscript(e.target.value)}
								rows={2}
								className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary"
								placeholder="Enter the exact words spoken in the reference audio sample..."
							/>
						</div>

						<div className="flex items-center justify-end pt-1">
							<Button
								size="sm"
								variant="ghost"
								className="h-6 text-[10px] text-muted-foreground hover:text-foreground gap-1 px-2"
								onPress={handleRetranscribeReference}
								isDisabled={isTranscribingReference}
							>
								<ArrowClockwise className={cn("size-3", isTranscribingReference && "animate-spin")} />
								{isTranscribingReference ? "Transcribing..." : "Re-transcribe with Whisper"}
							</Button>
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						{/* Source Method Selection */}
						<ChoiceGroup
							value={voiceSourceMode}
							onValueChange={(val) => setVoiceSourceMode(val as "timeline" | "upload" | "record")}
						>
							<ChoiceItem value="timeline">
								<span className="flex items-center gap-1.5 text-xs">
									<Scissors className="size-3.5" /> From Recording
								</span>
							</ChoiceItem>
							<ChoiceItem value="upload">
								<span className="flex items-center gap-1.5 text-xs">
									<UploadSimple className="size-3.5" /> Upload File
								</span>
							</ChoiceItem>
							<ChoiceItem value="record">
								<span className="flex items-center gap-1.5 text-xs">
									<MicrophoneIcon className="size-3.5" /> Quick Record
								</span>
							</ChoiceItem>
						</ChoiceGroup>

						{/* Method 1: Extract from Timeline Recording */}
						{voiceSourceMode === "timeline" && (
							<div className="rounded-xl border border-dashed border-border p-3.5 flex flex-col items-center justify-center gap-2.5 text-center bg-foreground/[0.02]">
								<p className="text-xs text-muted-foreground leading-relaxed">
									Extract a clear 5-10 second speech snippet from the microphone track of your recording to clone your voice.
								</p>
								<Button
									size="sm"
									variant="outline"
									className="h-8 text-xs gap-1.5"
									onPress={handleExtractReference}
									isDisabled={isExtractingReference}
								>
									<Scissors className="size-3.5" />
									{isExtractingReference ? "Extracting audio..." : "Extract Voice Sample"}
								</Button>
							</div>
						)}

						{/* Method 2: Upload External Audio File */}
						{voiceSourceMode === "upload" && (
							<div className="rounded-xl border border-dashed border-border p-3.5 flex flex-col items-center justify-center gap-2.5 text-center bg-foreground/[0.02]">
								<p className="text-xs text-muted-foreground leading-relaxed">
									Upload an external voice sample (<code className="text-[11px]">.wav, .mp3, .m4a, .flac</code>). 5-15 seconds recommended.
								</p>
								<Button
									size="sm"
									variant="outline"
									className="h-8 text-xs gap-1.5"
									onPress={() => void handleUploadReference()}
									isDisabled={isUploadingReference}
								>
									<UploadSimple className="size-3.5" />
									{isUploadingReference ? "Importing audio..." : "Select Audio File"}
								</Button>
							</div>
						)}

						{/* Method 3: Live Quick Record */}
						{voiceSourceMode === "record" && (
							<div className="rounded-xl border border-border bg-card/50 p-3.5 flex flex-col gap-2.5">
								<div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-background/50 p-2.5">
									<span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
										Reading Prompt (read aloud):
									</span>
									<p className="text-xs text-foreground italic leading-relaxed">
										"{DEFAULT_PROMPT_SCRIPT}"
									</p>
								</div>

								{voiceRecorder.error && (
									<p className="text-xs text-destructive">{voiceRecorder.error}</p>
								)}

								{voiceRecorder.isRecording ? (
									<div className="flex flex-col gap-2 pt-1">
										<div className="flex items-center justify-between text-xs">
											<span className="flex items-center gap-1.5 font-medium text-destructive">
												<span className="size-2 rounded-full bg-destructive animate-pulse" />
												Recording (00:0{voiceRecorder.durationSec} / 00:08)
											</span>
											<span className="text-[11px] text-muted-foreground">
												Level: {Math.round(voiceRecorder.volume * 100)}%
											</span>
										</div>

										{/* Live VU meter */}
										<div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
											<div
												className="h-full bg-destructive transition-all duration-75"
												style={{ width: `${Math.round(voiceRecorder.volume * 100)}%` }}
											/>
										</div>

										<div className="flex items-center gap-2 mt-1">
											<Button
												size="sm"
												variant="danger"
												className="h-8 text-xs flex-1 gap-1.5"
												onPress={() => void voiceRecorder.stopRecording()}
											>
												Stop & Save Sample
											</Button>
											<Button
												size="sm"
												variant="ghost"
												className="h-8 text-xs"
												onPress={voiceRecorder.cancelRecording}
											>
												Cancel
											</Button>
										</div>
									</div>
								) : isSavingLiveReference ? (
									<div className="flex items-center justify-center py-2 text-xs text-muted-foreground gap-2">
										<span className="size-2 rounded-full bg-primary animate-ping" />
										Processing and transcribing live sample with Whisper...
									</div>
								) : (
									<Button
										size="sm"
										variant="primary"
										className="h-8 text-xs gap-1.5"
										onPress={() => void voiceRecorder.startRecording()}
									>
										<MicrophoneIcon className="size-3.5" />
										Start 8s Voice Recording
									</Button>
								)}
							</div>
						)}
					</div>
				)}
			</section>

			{/* Translation Engine Selection */}
			<section className="flex flex-col gap-3">
				<div className="flex items-center justify-between">
					<Label className="text-[13px] font-medium">Translation Engine</Label>
				</div>

				<ChoiceGroup
					aria-label="Translation engine"
					value={translationEngine}
					onValueChange={(val) =>
						updateTranslationEngine(val as DubbingTranslationEngine)
					}
					className="grid grid-cols-2 gap-2"
				>
					<ChoiceItem value="local-nllb">Local Model</ChoiceItem>
					<ChoiceItem value="api">Cloud API</ChoiceItem>
				</ChoiceGroup>

				{/* If Local Model NLLB Engine selected */}
				{translationEngine === "local-nllb" && (
					<div className="flex flex-col gap-3 pt-1">
						{selectedQuantStatus.exists && !isSwitchingTranslationQuant ? (
							<div className="rounded-xl border border-border/80 bg-card p-3 flex flex-col gap-2.5">
								<div className="flex items-center justify-between gap-2">
									<div className="flex items-center gap-2 min-w-0">
										<span className="size-2 rounded-full bg-emerald-500 shrink-0" />
										<span className="text-xs font-semibold text-foreground truncate">
											NLLB-200 (
											{QUANTIZATION_OPTIONS.find((o) => o.id === translationQuantization)?.name ??
												translationQuantization.toUpperCase()}
											)
										</span>
									</div>
									<div className="flex items-center gap-1.5 shrink-0">
										<span className="rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap shrink-0">
											Installed & Ready
										</span>
										<span className="font-mono text-[11px] text-muted-foreground shrink-0">
											{QUANTIZATION_OPTIONS.find((o) => o.id === translationQuantization)?.size}
										</span>
									</div>
								</div>
								<p className="text-xs text-muted-foreground leading-relaxed">
									Offline neural translation model • Ready for high-quality multilingual dubbing
								</p>
								<div className="flex items-center justify-between pt-1 border-t border-border/40">
									<Button
										size="sm"
										variant="ghost"
										className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
										onPress={() => setIsSwitchingTranslationQuant(true)}
									>
										Switch / Re-download
									</Button>
									<Button
										size="sm"
										variant="ghost"
										className="h-7 text-xs text-destructive hover:bg-destructive/10 px-2 gap-1"
										onPress={() => handleDeleteTranslationModel(translationQuantization)}
									>
										<Trash className="size-3" />
										Delete Model
									</Button>
								</div>
							</div>
						) : (
							<>
								<div className="flex items-center justify-between">
									<Label className="text-[12px] font-medium">Model Quantization</Label>
									{isSwitchingTranslationQuant && selectedQuantStatus.exists ? (
										<Button
											size="sm"
											variant="ghost"
											className="h-6 text-[11px] text-muted-foreground hover:text-foreground px-1.5"
											onPress={() => setIsSwitchingTranslationQuant(false)}
										>
											Done
										</Button>
									) : (
										<span className="text-[11px] text-muted-foreground">
											Select to download
										</span>
									)}
								</div>

								{/* Quantization options */}
								<div className="flex flex-col gap-2">
									{QUANTIZATION_OPTIONS.map((opt) => {
										const isSelected = translationQuantization === opt.id;
										const status = modelStatusByQuantization[opt.id];
										const isInstalled = Boolean(status?.exists);

										return (
											<button
												type="button"
												key={opt.id}
												onClick={() => updateTranslationQuantization(opt.id)}
												className={cn(
													"group relative flex flex-col gap-1.5 p-3 rounded-xl border text-left transition-all",
													isSelected
														? "border-primary bg-primary/[0.07] shadow-xs"
														: "border-border/70 bg-card/40 hover:bg-card/75 hover:border-border",
												)}
											>
												<div className="flex items-center justify-between gap-2 w-full">
													<div className="flex items-center gap-2 min-w-0 flex-wrap">
														<div
															className={cn(
																"size-4 shrink-0 rounded-full border flex items-center justify-center transition-colors",
																isSelected
																	? "border-primary bg-primary"
																	: "border-muted-foreground/40 group-hover:border-muted-foreground/70",
															)}
														>
															{isSelected && (
																<span className="size-1.5 rounded-full bg-primary-foreground" />
															)}
														</div>
														<span className="text-xs font-semibold text-foreground tracking-tight">
															{opt.name}
														</span>
														<span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] text-muted-foreground leading-none shrink-0">
															{opt.badge}
														</span>
														{isInstalled && (
															<span className="rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] font-medium leading-none shrink-0 flex items-center gap-1">
																<span className="size-1 rounded-full bg-emerald-500" />
																Installed
															</span>
														)}
													</div>
													<span className="font-mono text-[11px] font-medium text-muted-foreground bg-muted/70 px-1.5 py-0.5 rounded leading-none shrink-0">
														{opt.size}
													</span>
												</div>
												<p className="pl-6 text-xs text-muted-foreground leading-relaxed">
													{opt.description}
												</p>
											</button>
										);
									})}
								</div>

								{/* Selected Quantization Model Download & Status Card */}
								<div className="rounded-xl border border-border/80 bg-card p-3 flex flex-col gap-2">
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<span className="text-xs font-medium">
												{translationQuantization.toUpperCase()} Model:
											</span>
											{selectedQuantStatus.exists ? (
												<span className="text-[11px] text-emerald-500 font-medium">
													Installed & Ready
												</span>
											) : selectedQuantStatus.isDownloading ? (
												<span className="text-[11px] text-primary font-medium">
													Downloading ({Math.round(selectedQuantStatus.progress)}%)
												</span>
											) : (
												<span className="text-[11px] text-amber-500 font-medium">
													Not downloaded
												</span>
											)}
										</div>

										{!selectedQuantStatus.exists &&
											!selectedQuantStatus.isDownloading && (
												<Button
													size="sm"
													variant="primary"
													className="h-7 text-xs px-2.5"
													onPress={() =>
														handleDownloadModel(translationQuantization)
													}
												>
													Download
												</Button>
											)}
									</div>

									{selectedQuantStatus.isDownloading && (
										<ProgressBar
											value={selectedQuantStatus.progress}
											className="w-full h-1.5"
											aria-label="Model download progress"
										/>
									)}
								</div>
							</>
						)}
					</div>
				)}

				{/* If Cloud API selected */}
				{translationEngine === "api" && (
					<div className="flex flex-col gap-3 pt-1">
						<div className="flex items-center justify-between">
							<Label className="text-[12px] font-medium">API Provider</Label>
						</div>
						<ChoiceGroup
							aria-label="API translation provider"
							value={apiTranslationProvider}
							onValueChange={(val) =>
								updateApiTranslationProvider(val as DubbingApiTranslationProvider)
							}
							className="grid grid-cols-2 gap-2"
						>
							<ChoiceItem value="openai">OpenAI</ChoiceItem>
							<ChoiceItem value="deepl">DeepL</ChoiceItem>
						</ChoiceGroup>

						{apiTranslationProvider === "openai" ? (
							/* OpenAI & OpenAI-Compatible Custom Endpoint Config */
							<div className="flex flex-col gap-2.5 rounded-xl border border-border/80 bg-card/60 p-3">
								<div className="flex flex-col gap-0.5">
									<div className="flex items-center justify-between">
										<Label className="text-[12px] font-medium">OpenAI API Settings</Label>
										{(controller.customOpenAiConfig.hasApiKey || savedApiKeys.openai) && (
											<span className="text-[10px] text-emerald-500 font-medium">
												Configured
											</span>
										)}
									</div>
									<p className="text-[11px] text-muted-foreground">
										Compatible with OpenAI, Groq, Together, Ollama, OpenRouter, etc.
									</p>
								</div>

								<div className="flex flex-col gap-1">
									<Label className="text-[11px] text-muted-foreground">API Key</Label>
									<input
										type="password"
										value={controller.customOpenAiInputs.apiKey}
										onChange={(e) =>
											controller.setCustomOpenAiInputs((prev) => ({
												...prev,
												apiKey: e.target.value,
											}))
										}
										placeholder={
											controller.customOpenAiConfig.hasApiKey || savedApiKeys.openai
												? "•••••••••••••••• (saved)"
												: "sk-..."
										}
										className="rounded-md border border-input bg-background px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
									/>
								</div>

								<div className="flex flex-col gap-1">
									<Label className="text-[11px] text-muted-foreground">
										Custom API Base URL (optional)
									</Label>
									<input
										type="text"
										value={controller.customOpenAiInputs.baseUrl}
										onChange={(e) =>
											controller.setCustomOpenAiInputs((prev) => ({
												...prev,
												baseUrl: e.target.value,
											}))
										}
										placeholder="https://api.openai.com/v1 (or Groq, Together, Ollama, OpenRouter)"
										className="rounded-md border border-input bg-background px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
									/>
								</div>

								<div className="flex flex-col gap-1">
									<Label className="text-[11px] text-muted-foreground">Model Name</Label>
									<input
										type="text"
										value={controller.customOpenAiInputs.model}
										onChange={(e) =>
											controller.setCustomOpenAiInputs((prev) => ({
												...prev,
												model: e.target.value,
											}))
										}
										placeholder="gpt-4o-mini (e.g., gpt-4o, llama-3.3-70b-versatile)"
										className="rounded-md border border-input bg-background px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
									/>
								</div>

								<Button
									size="sm"
									variant="outline"
									className="h-7 text-xs self-end mt-1"
									onPress={controller.handleSaveCustomOpenAiConfig}
								>
									Save API Settings
								</Button>
							</div>
						) : (
							/* DeepL API Config */
							<div className="flex flex-col gap-2 rounded-xl border border-border/80 bg-card/60 p-3">
								<div className="flex items-center justify-between">
									<Label className="text-[12px] font-medium">DeepL API Key</Label>
									{savedApiKeys.deepl && (
										<span className="text-[10px] text-emerald-500 font-medium">
											Saved securely
										</span>
									)}
								</div>
								<div className="flex gap-2">
									<input
										type="password"
										value={apiKeyTempInputs.deepl}
										onChange={(e) =>
											setApiKeyTempInputs((prev) => ({
												...prev,
												deepl: e.target.value,
											}))
										}
										placeholder={
											savedApiKeys.deepl
												? "••••••••••••••••"
												: "Enter DeepL API key"
										}
										className="flex-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
									/>
									<Button
										size="sm"
										variant="outline"
										className="h-7 text-xs"
										onPress={() =>
											handleSaveApiKey("deepl", apiKeyTempInputs.deepl)
										}
									>
										Save
									</Button>
								</div>
								<p className="text-[10px] text-muted-foreground leading-tight">
									Target language codes are automatically normalized for DeepL (e.g., EN-US, PT-BR, ZH-HANS).
								</p>
							</div>
						)}
					</div>
				)}
			</section>

			{/* Voice Synthesis (Fish Audio S2-Pro) Backend Selection */}
			<section className="flex flex-col gap-3">
				<div className="flex items-center justify-between">
					<Label className="text-[13px] font-medium">
						Voice Synthesis (Fish Audio S2-Pro)
					</Label>
				</div>

				<ChoiceGroup
					aria-label="TTS Backend"
					value={ttsBackend}
					onValueChange={(val) => updateTtsBackend(val as DubbingTtsBackend)}
					className="grid grid-cols-2 gap-2"
				>
					<ChoiceItem value="cloud">Cloud API</ChoiceItem>
					<ChoiceItem value="local">Local Engine</ChoiceItem>
				</ChoiceGroup>

				{ttsBackend === "cloud" && (
					<div className="flex flex-col gap-3 pt-1">
						<div className="flex items-center justify-between">
							<Label className="text-[12px] font-medium">Cloud Provider</Label>
						</div>
						<ChoiceGroup
							aria-label="Cloud TTS Provider"
							value={cloudProvider}
							onValueChange={(val) =>
								updateCloudProvider(val as DubbingCloudProvider)
							}
							className="grid grid-cols-2 gap-2"
						>
							<ChoiceItem value="fish-audio">Official Fish Audio</ChoiceItem>
							<ChoiceItem value="acedatacloud">AceDataCloud</ChoiceItem>
						</ChoiceGroup>

						{/* API Key for selected TTS provider */}
						<div className="flex flex-col gap-1.5">
							<div className="flex items-center justify-between">
								<Label className="text-[11px] text-muted-foreground">
									{cloudProvider === "fish-audio" ? "Fish Audio" : "AceData"} API
									Key
								</Label>
								{savedApiKeys[cloudProvider] && (
									<span className="text-[10px] text-emerald-500 font-medium">
										Saved securely
									</span>
								)}
							</div>
							<div className="flex gap-2">
								<input
									type="password"
									value={apiKeyTempInputs[cloudProvider]}
									onChange={(e) =>
										setApiKeyTempInputs((prev) => ({
											...prev,
											[cloudProvider]: e.target.value,
										}))
									}
									placeholder={
										savedApiKeys[cloudProvider]
											? "••••••••••••••••"
											: "Enter API key"
									}
									className="flex-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
								/>
								<Button
									size="sm"
									variant="outline"
									className="h-7 text-xs"
									onPress={() =>
										handleSaveApiKey(
											cloudProvider,
											apiKeyTempInputs[cloudProvider],
										)
									}
								>
									Save
								</Button>
							</div>
						</div>
					</div>
				)}

				{ttsBackend === "local" && (
					<div className="flex flex-col gap-3 pt-1">
						{(() => {
							const selectedTtsStatus =
								controller.ttsModelStatusByQuantization[controller.ttsQuantization];
							const isDownloading = selectedTtsStatus?.isDownloading;
							const isInstalled = selectedTtsStatus?.exists;
							const currentOption =
								TTS_QUANTIZATION_OPTIONS.find(
									(o) => o.id === controller.ttsQuantization,
								) ?? TTS_QUANTIZATION_OPTIONS[0];

							if (isInstalled && !isSwitchingTtsQuant) {
								return (
									<div className="rounded-xl border border-border/80 bg-card p-3 flex flex-col gap-2.5">
										<div className="flex items-center justify-between gap-2">
											<div className="flex items-center gap-2 min-w-0">
												<span className="size-2 rounded-full bg-emerald-500 shrink-0" />
												<span className="text-xs font-semibold text-foreground truncate">
													S2-Pro ({currentOption.name})
												</span>
											</div>
											<div className="flex items-center gap-1.5 shrink-0">
												<span className="rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap shrink-0">
													Installed & Ready
												</span>
												<span className="font-mono text-[11px] text-muted-foreground shrink-0">
													{currentOption.size}
												</span>
											</div>
										</div>
										<p className="text-xs text-muted-foreground leading-relaxed">
											Zero-shot cloning engine • {currentOption.size} • Ready offline
										</p>
										<div className="flex items-center justify-between pt-1 border-t border-border/40">
											<Button
												size="sm"
												variant="ghost"
												className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
												onPress={() => setIsSwitchingTtsQuant(true)}
											>
												Switch Quantization
											</Button>
											<Button
												size="sm"
												variant="ghost"
												className="h-7 text-xs text-destructive hover:bg-destructive/10 px-2 gap-1"
												onPress={() =>
													handleDeleteTtsModel(controller.ttsQuantization)
												}
											>
												<Trash className="size-3" />
												Delete Model
											</Button>
										</div>
									</div>
								);
							}

							return (
								<>
									<div className="flex items-center justify-between">
										<Label className="text-[12px] font-medium">
											Fish Audio S2-Pro Weights
										</Label>
										{isSwitchingTtsQuant && isInstalled ? (
											<Button
												size="sm"
												variant="ghost"
												className="h-6 text-[11px] text-muted-foreground hover:text-foreground px-1.5"
												onPress={() => setIsSwitchingTtsQuant(false)}
											>
												Done
											</Button>
										) : (
											<span className="text-[11px] text-muted-foreground">
												Select quantization
											</span>
										)}
									</div>

									{/* Quantization options */}
									<div className="flex flex-col gap-2.5">
										{TTS_QUANTIZATION_OPTIONS.map((opt) => {
											const isSelected = controller.ttsQuantization === opt.id;
											const status = controller.ttsModelStatusByQuantization[opt.id];
											const installed = Boolean(status?.exists);

											return (
												<button
													type="button"
													key={opt.id}
													onClick={() => controller.updateTtsQuantization(opt.id)}
													className={cn(
														"group relative flex flex-col gap-1.5 p-3 rounded-xl border text-left transition-all",
														isSelected
															? "border-primary bg-primary/[0.07] shadow-xs"
															: "border-border/70 bg-card/40 hover:bg-card/75 hover:border-border",
													)}
												>
													{/* Row 1: Radio Ring + Model Name + Badges + Size */}
													<div className="flex items-center justify-between gap-2 w-full">
														<div className="flex items-center gap-2 min-w-0 flex-wrap">
															{/* Radio Ring */}
															<div
																className={cn(
																	"size-4 shrink-0 rounded-full border flex items-center justify-center transition-colors",
																	isSelected
																		? "border-primary bg-primary"
																		: "border-muted-foreground/40 group-hover:border-muted-foreground/70",
																)}
															>
																{isSelected && (
																	<span className="size-1.5 rounded-full bg-primary-foreground" />
																)}
															</div>

															{/* Model Name */}
															<span className="text-xs font-semibold text-foreground tracking-tight">
																{opt.name}
															</span>

															{/* Badge / Tag */}
															<span
																className={cn(
																	"rounded px-1.5 py-0.5 text-[10px] font-medium leading-none shrink-0",
																	opt.id === "q5_k_m"
																		? "bg-primary/15 text-primary font-semibold"
																		: opt.id === "f16"
																			? "bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold"
																			: "bg-foreground/10 text-muted-foreground",
																)}
															>
																{opt.badge}
															</span>

															{/* Installed Indicator */}
															{installed && (
																<span className="rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] font-medium leading-none shrink-0 flex items-center gap-1">
																	<span className="size-1 rounded-full bg-emerald-500" />
																	Installed
																</span>
															)}
														</div>

														{/* Size Tag */}
														<span className="font-mono text-[11px] font-medium text-muted-foreground bg-muted/70 px-1.5 py-0.5 rounded leading-none shrink-0">
															{opt.size}
														</span>
													</div>

													{/* Row 2: Description + Hardware Guideline */}
													<div className="pl-6 flex flex-col gap-1">
														<p className="text-xs text-muted-foreground leading-relaxed">
															{opt.description}
														</p>
														<span className="text-[10px] font-medium text-muted-foreground/80 pt-0.5">
															⚡ {opt.recommendedRam}
														</span>
													</div>
												</button>
											);
										})}
									</div>

									{/* Download status & action card */}
									{isDownloading ? (
										<div className="rounded-xl border border-primary/30 bg-primary/[0.05] p-3.5 flex flex-col gap-2.5">
											<div className="flex items-center justify-between gap-2">
												<div className="flex items-center gap-2 min-w-0">
													<span className="size-2 rounded-full bg-primary animate-pulse shrink-0" />
													<span className="text-xs font-semibold text-foreground truncate">
														Downloading {currentOption.name}
													</span>
													<span className="font-mono text-xs font-bold text-primary shrink-0">
														{Math.min(
															100,
															Math.max(0, Math.round(selectedTtsStatus.progress)),
														)}
														%
													</span>
												</div>
												<Button
													size="sm"
													variant="ghost"
													className="h-6 text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 px-2 shrink-0"
													onPress={() => void handleCancelTtsModelDownload()}
												>
													Cancel
												</Button>
											</div>

											<div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
												<span>
													{formatBytes(selectedTtsStatus.downloadedBytes ?? 0)} /{" "}
													{formatBytes(
														selectedTtsStatus.totalBytes &&
															selectedTtsStatus.totalBytes > 0
															? selectedTtsStatus.totalBytes
															: currentOption.sizeBytes,
													)}
												</span>
												<span>
													{selectedTtsStatus.speed
														? `${(selectedTtsStatus.speed / 1_048_576).toFixed(1)} MB/s`
														: "Connecting..."}
													{selectedTtsStatus.eta !== undefined &&
													selectedTtsStatus.eta > 0
														? ` • ETA ${selectedTtsStatus.eta}s`
														: ""}
												</span>
											</div>

											<div className="h-2 w-full bg-primary/15 rounded-full overflow-hidden">
												<div
													className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
													style={{
														width: `${Math.min(100, Math.max(0, Math.round(selectedTtsStatus.progress)))}%`,
													}}
												/>
											</div>
										</div>
									) : (
										<div className="rounded-xl border border-border/80 bg-card p-3 flex items-center justify-between gap-3">
											<div className="flex flex-col gap-0.5 min-w-0">
												<span className="text-xs font-medium text-foreground truncate">
													{currentOption.name} Weights
												</span>
												{isInstalled ? (
													<span className="text-[11px] text-emerald-500 font-medium flex items-center gap-1.5">
														<span className="size-1.5 rounded-full bg-emerald-500" />
														Ready for Offline Voice Synthesis
													</span>
												) : (
													<span className="text-[11px] text-amber-500 font-medium">
														Not installed offline ({currentOption.size})
													</span>
												)}
											</div>

											{!isInstalled ? (
												<Button
													size="sm"
													variant="primary"
													className="h-8 text-xs font-medium px-3 shrink-0"
													onPress={() =>
														handleDownloadTtsModel(controller.ttsQuantization)
													}
												>
													Download {currentOption.size}
												</Button>
											) : (
												<Button
													size="sm"
													variant="ghost"
													className="h-7 text-[11px] text-muted-foreground hover:text-foreground px-2 shrink-0"
													onPress={() =>
														handleDownloadTtsModel(controller.ttsQuantization)
													}
												>
													Re-download
												</Button>
											)}
										</div>
									)}
								</>
							);
						})()}
					</div>
				)}

			</section>

			{/* Pipeline Execution Action */}
			<section className="flex flex-col gap-3 pt-2">
				{generationError && (
					<div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-[11px] text-destructive">
						{generationError}
					</div>
				)}

				{/* Sleek Consumer-Grade Dubbing Progress Card */}
				{isGenerating && (
					<div className="flex flex-col gap-3 rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/10 to-primary/5 p-4 shadow-sm backdrop-blur-md transition-all animate-in fade-in duration-300">
						{/* Header: Title + Animated Percentage Badge */}
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2.5">
								<span className="relative flex size-2.5">
									<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
									<span className="relative inline-flex size-2.5 rounded-full bg-primary" />
								</span>
								<span className="text-xs font-semibold tracking-tight text-foreground">
									Dubbing in Progress...
								</span>
							</div>
							<span className="font-mono text-xs font-bold text-primary px-2 py-0.5 rounded-full bg-primary/15 border border-primary/20">
								{generationProgress}%
							</span>
						</div>

						{/* Smooth Gradient Progress Bar */}
						<div className="h-2 w-full rounded-full bg-primary/15 overflow-hidden p-0.5">
							<div
								className="h-full rounded-full bg-gradient-to-r from-primary via-indigo-500 to-primary bg-[length:200%_100%] animate-gradient transition-all duration-300 ease-out"
								style={{ width: `${Math.min(100, Math.max(4, generationProgress))}%` }}
							/>
						</div>

						{/* Human-Centered Status Copy & Cancel Action */}
						<div className="flex items-center justify-between text-xs pt-0.5">
							<span className="text-muted-foreground text-[11px] font-medium truncate max-w-[220px]">
								{generationStageText}
							</span>
							<Button
								size="sm"
								variant="ghost"
								className="h-6 text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 px-2 rounded-md transition-colors"
								onPress={handleCancelDubbing}
							>
								Cancel
							</Button>
						</div>
					</div>
				)}

				<Button
					size="lg"
					variant="primary"
					className="w-full h-10 text-xs font-semibold"
					onPress={handleGenerateDubbing}
					isDisabled={
						isGenerating ||
						(translationEngine === "local-nllb" && !selectedQuantStatus.exists) ||
						(ttsBackend === "local" &&
							!controller.ttsModelStatusByQuantization[controller.ttsQuantization]?.exists)
					}
				>
					{isGenerating
						? "Generating Dubbed Track..."
						: `Dub Video in ${selectedLangObj?.name ?? "Target Language"}`}
				</Button>

				{translationEngine === "local-nllb" && !selectedQuantStatus.exists && (
					<p className="text-[11px] text-amber-500 text-center">
						Please download the {translationQuantization.toUpperCase()} translation model first to
						dub offline.
					</p>
				)}

				{ttsBackend === "local" &&
					!controller.ttsModelStatusByQuantization[controller.ttsQuantization]?.exists && (
						<p className="text-[11px] text-amber-500 text-center">
							Please download the {controller.ttsQuantization.toUpperCase()} Fish Audio weights
							to synthesize offline.
						</p>
					)}
			</section>
		</div>
	);
}
