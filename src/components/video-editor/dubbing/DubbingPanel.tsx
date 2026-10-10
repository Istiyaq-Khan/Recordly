import { Button, Card, Label, ProgressBar, Radio, RadioGroup } from "@heroui/react";
import { useEffect, useState } from "react";
import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
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
	DubbingModelQuantization,
	DubbingTranslationEngine,
	DubbingTtsBackend,
} from "../types";
import {
	QUANTIZATION_OPTIONS,
	SUPPORTED_DUBBING_LANGUAGES,
	TTS_QUANTIZATION_OPTIONS,
	type TtsQuantization,
} from "./constants";
import type { useDubbingController } from "./useDubbingController";

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
		referenceAudioPath,
		referenceDurationSec,
		referenceTranscript,
		setReferenceTranscript,
		isExtractingReference,
		handleExtractReference,
		generationStage,
		generationProgress,
		generationError,
		handleGenerateDubbing,
		dubbingTrack,
		handleToggleActiveTrack,
		handleSetVolume,
		handleRemoveDubbedTrack,
	} = controller;

	const selectedQuantStatus = modelStatusByQuantization[translationQuantization];
	const isGenerating =
		generationStage !== "idle" && generationStage !== "ready" && generationStage !== "error";

	const selectedLangObj = SUPPORTED_DUBBING_LANGUAGES.find((l) => l.code === targetLanguage);

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
		<div className="flex flex-col gap-5 py-1">
			{/* Active Track Status (if dubbed track exists) */}
			{dubbingTrack && (
				<Card className="border border-primary/20 bg-primary/5 p-3.5 rounded-xl flex flex-col gap-3">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<span className="flex size-2 rounded-full bg-emerald-500 animate-pulse" />
							<span className="text-xs font-semibold uppercase tracking-wider text-primary">
								Dubbed Audio Track
							</span>
							<span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary uppercase">
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
							? "Dubbed audio is active on timeline and will replace original speech in export."
							: "Dubbed audio is muted. Original microphone speech is playing."}
					</p>

					<div className="pt-1">
						<SliderControl
							label="Dubbed Volume"
							value={Math.round((dubbingTrack.volume ?? 1) * 100)}
							min={0}
							max={200}
							step={5}
							onChange={(val) => handleSetVolume(val / 100)}
							formatValue={(val) => `${Math.round(val)}%`}
						/>
					</div>

					<div className="flex items-center justify-between pt-1 border-t border-border/40">
						<span className="text-[11px] text-muted-foreground">
							{(dubbingTrack.syncedCues ?? dubbingTrack.syncedCaptions ?? []).length}{" "}
							time-synced cues
						</span>
						<Button
							size="sm"
							variant="ghost"
							className="h-7 text-[11px] text-destructive hover:bg-destructive/10"
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

			{/* Zero-Shot Voice Reference Sample */}
			<section className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<Label className="text-[13px] font-medium">Creator Voice Sample</Label>
					<span className="text-[11px] text-muted-foreground">
						Zero-shot cloning (5-10s)
					</span>
				</div>

				{referenceAudioPath ? (
					<div className="rounded-xl border border-border bg-card/50 p-3 flex flex-col gap-2.5">
						<div className="flex items-center justify-between">
							<span className="text-[11px] text-emerald-500 font-medium flex items-center gap-1.5">
								<span className="size-1.5 rounded-full bg-emerald-500" />
								Sample Ready (
								{referenceDurationSec
									? `${referenceDurationSec.toFixed(1)}s`
									: "Extracted"}
								)
							</span>
							<Button
								size="sm"
								variant="ghost"
								className="h-6 text-[10px] text-muted-foreground hover:text-foreground"
								onPress={handleExtractReference}
								isDisabled={isExtractingReference}
							>
								{isExtractingReference ? "Extracting..." : "Re-extract"}
							</Button>
						</div>

						<audio
							controls
							src={audioPreviewUrl ?? undefined}
							className="w-full h-7 mt-0.5 rounded"
						/>

						<div className="flex flex-col gap-1 mt-1">
							<Label className="text-[11px] text-muted-foreground">
								Reference Transcript (must match voice sample exactly)
							</Label>
							<textarea
								value={referenceTranscript}
								onChange={(e) => setReferenceTranscript(e.target.value)}
								rows={2}
								className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary"
								placeholder="Enter the exact words spoken in the reference audio sample..."
							/>
						</div>
					</div>
				) : (
					<div className="rounded-xl border border-dashed border-border p-4 flex flex-col items-center justify-center gap-2 text-center bg-foreground/[0.02]">
						<p className="text-xs text-muted-foreground">
							Extract a clear 5-10 second speech sample from your recording to clone
							your voice.
						</p>
						<Button
							size="sm"
							variant="outline"
							className="h-8 text-xs gap-1.5"
							onPress={handleExtractReference}
							isDisabled={isExtractingReference}
						>
							{isExtractingReference ? "Extracting audio..." : "Extract Voice Sample"}
						</Button>
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
						<div className="flex items-center justify-between">
							<Label className="text-[12px] font-medium">Model Quantization</Label>
							<span className="text-[11px] text-muted-foreground">
								Select to download
							</span>
						</div>

						{/* Radio group for quantization options */}
						<RadioGroup
							value={translationQuantization}
							onChange={(val) =>
								updateTranslationQuantization(val as DubbingModelQuantization)
							}
							className="flex flex-col gap-2"
						>
							{QUANTIZATION_OPTIONS.map((opt) => {
								const status = modelStatusByQuantization[opt.id];
								return (
									<Radio
										key={opt.id}
										value={opt.id}
										className={cn(
											"rounded-xl border p-2.5 transition-all",
											translationQuantization === opt.id
												? "border-primary bg-primary/5"
												: "border-border hover:bg-card/40",
										)}
									>
										<Radio.Content className="w-full">
											<div className="flex items-center justify-between w-full">
											<div className="flex items-center gap-2">
												<Radio.Control>
													<Radio.Indicator />
												</Radio.Control>
												<span className="text-xs font-semibold">
													{opt.name}
												</span>
												<span className="rounded bg-foreground/10 px-1.5 py-0.2 text-[10px] text-muted-foreground">
													{opt.badge}
												</span>
												{status.exists && (
													<span className="rounded bg-emerald-500/15 text-emerald-500 px-1 py-0.2 text-[9px] font-medium">
														Installed
													</span>
												)}
											</div>
											<span className="text-[11px] font-mono text-muted-foreground">
												{opt.size}
											</span>
										</div>
										<p className="text-[11px] text-muted-foreground mt-1 ml-6 leading-tight">
											{opt.description}
										</p>
									</Radio.Content>
								</Radio>
								);
							})}
						</RadioGroup>

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
											Downloading ({Math.round(selectedQuantStatus.progress)}
											%)
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
							<ChoiceItem value="openai">OpenAI / Compatible</ChoiceItem>
							<ChoiceItem value="deepl">DeepL</ChoiceItem>
						</ChoiceGroup>

						{apiTranslationProvider === "openai" ? (
							/* OpenAI & OpenAI-Compatible Custom Endpoint Config */
							<div className="flex flex-col gap-2.5 rounded-xl border border-border/80 bg-card/60 p-3">
								<div className="flex items-center justify-between">
									<Label className="text-[12px] font-medium">OpenAI / Custom Endpoint</Label>
									{(controller.customOpenAiConfig.hasApiKey || savedApiKeys.openai) && (
										<span className="text-[10px] text-emerald-500 font-medium">
											Configured
										</span>
									)}
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
									Save Endpoint Settings
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
						<div className="flex items-center justify-between">
							<Label className="text-[12px] font-medium">Fish Audio S2-Pro Weights</Label>
							<span className="text-[11px] text-muted-foreground">Select quantization</span>
						</div>

						{/* Radio group for TTS quantization options */}
						<RadioGroup
							value={controller.ttsQuantization}
							onChange={(val) => controller.updateTtsQuantization(val as TtsQuantization)}
							className="flex flex-col gap-2"
						>
							{TTS_QUANTIZATION_OPTIONS.map((opt) => {
								const status = controller.ttsModelStatusByQuantization[opt.id];
								return (
									<Radio
										key={opt.id}
										value={opt.id}
										className={cn(
											"rounded-xl border p-2.5 transition-all",
											controller.ttsQuantization === opt.id
												? "border-primary bg-primary/5"
												: "border-border hover:bg-card/40",
										)}
									>
										<Radio.Content className="w-full">
											<div className="flex items-center justify-between w-full">
												<div className="flex items-center gap-2">
													<Radio.Control>
														<Radio.Indicator />
													</Radio.Control>
													<span className="text-xs font-semibold">{opt.name}</span>
													<span className="rounded bg-foreground/10 px-1.5 py-0.2 text-[10px] text-muted-foreground">
														{opt.badge}
													</span>
													{status?.exists && (
														<span className="rounded bg-emerald-500/15 text-emerald-500 px-1 py-0.2 text-[9px] font-medium">
															Installed
														</span>
													)}
												</div>
												<span className="text-[11px] font-mono text-muted-foreground">{opt.size}</span>
											</div>
											<div className="flex items-center justify-between mt-1 ml-6">
												<p className="text-[11px] text-muted-foreground leading-tight">
													{opt.description}
												</p>
												<span className="text-[10px] font-medium text-muted-foreground/80 shrink-0 ml-2">
													{opt.recommendedRam}
												</span>
											</div>
										</Radio.Content>
									</Radio>
								);
							})}
						</RadioGroup>

						{/* Download status & action card */}
						{(() => {
							const selectedTtsStatus = controller.ttsModelStatusByQuantization[controller.ttsQuantization];
							const isDownloading = selectedTtsStatus?.isDownloading;
							const exists = selectedTtsStatus?.exists;

							return (
								<div className="rounded-xl border border-border/80 bg-card p-3 flex flex-col gap-2">
									<div className="flex items-center justify-between">
										<div className="flex flex-col gap-0.5">
											<div className="flex items-center gap-2">
												<span className="text-xs font-medium">
													{controller.ttsQuantization.toUpperCase()} Model:
												</span>
												{exists ? (
													<span className="text-[11px] text-emerald-500 font-medium">
														Installed & Ready Offline
													</span>
												) : isDownloading ? (
													<span className="text-[11px] text-primary font-medium">
														Downloading ({Math.round(selectedTtsStatus.progress)}%)
													</span>
												) : (
													<span className="text-[11px] text-amber-500 font-medium">
														Not installed
													</span>
												)}
											</div>
											{isDownloading && (
												<div className="text-[10px] text-muted-foreground">
													{selectedTtsStatus.speed
														? `${(selectedTtsStatus.speed / 1_048_576).toFixed(1)} MB/s`
														: "Connecting..."}{" "}
													{selectedTtsStatus.eta !== undefined && selectedTtsStatus.eta > 0
														? `• ETA: ${selectedTtsStatus.eta}s`
														: ""}
												</div>
											)}
										</div>

										{!exists && !isDownloading && (
											<Button
												size="sm"
												variant="primary"
												className="h-7 text-xs px-2.5"
												onPress={() =>
													controller.handleDownloadTtsModel(controller.ttsQuantization)
												}
											>
												Download
											</Button>
										)}
									</div>

									{isDownloading && (
										<ProgressBar
											value={selectedTtsStatus.progress}
											className="w-full h-1.5"
											aria-label="Fish Audio model download progress"
										/>
									)}
								</div>
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

				{isGenerating && (
					<div className="flex flex-col gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
						<div className="flex items-center justify-between text-xs">
							<span className="font-medium text-primary capitalize">
								{generationStage === "extracting-ref" &&
									"Extracting voice sample..."}
								{generationStage === "translating" &&
									`Translating transcript into ${selectedLangObj?.name}...`}
								{generationStage === "synthesizing" &&
									"Cloning voice with Fish Audio S2-Pro..."}
								{generationStage === "aligning" &&
									"Time-aligning dubbed captions..."}
							</span>
							<span className="font-mono text-[11px] text-muted-foreground">
								{generationProgress}%
							</span>
						</div>
						<ProgressBar
							value={generationProgress}
							className="w-full h-1.5"
							aria-label="Dubbing generation progress"
						/>
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
