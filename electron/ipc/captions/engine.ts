import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import {
	getBundledSherpaOnnxExecutableCandidates,
	getBundledWhisperExecutableCandidates,
} from "../paths/binaries";
import type { CaptionCuePayload, CaptionEngineType } from "../types";
import { ensureReadableFile, isExecutableFile } from "./generateUtils";
import { resolveParakeetModelFiles } from "./parakeet";
import {
	parseParakeetJsonOutput,
	parseSrtCues,
	parseWhisperJsonCues,
	shouldRetryWhisperWithoutJson,
} from "./parser";
import { isMissingWindowsWhisperRuntimeDependency } from "./runtimeErrors";

const execFileAsync = promisify(execFile);

export interface TranscriptionRequest {
	videoPath: string;
	audioWavPath: string;
	language?: string;
	executablePath?: string | null;
	modelPath?: string | null;
}

export interface TranscriptionResult {
	cues: CaptionCuePayload[];
	engine: CaptionEngineType;
}

export interface ITranscriptionEngine {
	readonly id: CaptionEngineType;
	readonly name: string;
	resolveExecutable(preferredPath?: string | null): Promise<string>;
	validateModel(modelPath?: string | null): Promise<string>;
	transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

export async function resolveWhisperExecutablePath(preferredPath?: string | null): Promise<string> {
	const candidatePaths = [
		preferredPath?.trim() || null,
		...getBundledWhisperExecutableCandidates(),
		process.env["WHISPER_CPP_PATH"]?.trim() || null,
		process.platform === "darwin" ? "/opt/homebrew/bin/whisper-cli" : null,
		process.platform === "darwin" ? "/usr/local/bin/whisper-cli" : null,
		process.platform === "darwin" ? "/opt/homebrew/bin/whisper-cpp" : null,
		process.platform === "darwin" ? "/usr/local/bin/whisper-cpp" : null,
	].filter((value): value is string => Boolean(value));

	for (const candidate of candidatePaths) {
		const normalized = path.resolve(candidate);
		if (await isExecutableFile(normalized)) {
			return normalized;
		}
	}

	const pathCommand = process.platform === "win32" ? "where" : "which";
	const binaryNames =
		process.platform === "win32"
			? ["whisper-cli.exe", "whisper.exe", "main.exe"]
			: ["whisper-cli", "whisper-cpp", "whisper", "main"];

	for (const binaryName of binaryNames) {
		const result = spawnSync(pathCommand, [binaryName], { encoding: "utf-8" });
		if (result.status === 0) {
			const resolvedPath = result.stdout
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find(Boolean);

			if (resolvedPath && (await isExecutableFile(resolvedPath))) {
				return resolvedPath;
			}
		}
	}

	throw new Error(
		`No Whisper runtime was found for ${process.platform}/${process.arch}. ` +
			"This Recordly build is missing its bundled caption runtime. Reinstall or update Recordly, or select a whisper-cli executable in Caption settings.",
	);
}

export async function resolveSherpaOnnxExecutablePath(
	preferredPath?: string | null,
): Promise<string> {
	const candidatePaths = [
		preferredPath?.trim() || null,
		...getBundledSherpaOnnxExecutableCandidates(),
		process.env["SHERPA_ONNX_PATH"]?.trim() || null,
		process.platform === "darwin" ? "/opt/homebrew/bin/sherpa-onnx-offline" : null,
		process.platform === "darwin" ? "/usr/local/bin/sherpa-onnx-offline" : null,
	].filter((value): value is string => Boolean(value));

	for (const candidate of candidatePaths) {
		const normalized = path.resolve(candidate);
		if (await isExecutableFile(normalized)) {
			return normalized;
		}
	}

	const pathCommand = process.platform === "win32" ? "where" : "which";
	const binaryNames =
		process.platform === "win32"
			? ["sherpa-onnx-offline.exe", "sherpa-onnx.exe"]
			: ["sherpa-onnx-offline", "sherpa-onnx"];

	for (const binaryName of binaryNames) {
		const result = spawnSync(pathCommand, [binaryName], { encoding: "utf-8" });
		if (result.status === 0) {
			const resolvedPath = result.stdout
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find(Boolean);

			if (resolvedPath && (await isExecutableFile(resolvedPath))) {
				return resolvedPath;
			}
		}
	}

	throw new Error(
		`No sherpa-onnx runtime was found for ${process.platform}/${process.arch}. ` +
			"Install sherpa-onnx or select a sherpa-onnx-offline executable in Caption settings.",
	);
}

export class WhisperEngineAdapter implements ITranscriptionEngine {
	readonly id = "whisper" as const;
	readonly name = "Whisper (whisper.cpp)";

	async resolveExecutable(preferredPath?: string | null): Promise<string> {
		const exePath = await resolveWhisperExecutablePath(preferredPath);
		await ensureReadableFile(exePath, { executable: true });
		return exePath;
	}

	async validateModel(modelPath?: string | null): Promise<string> {
		if (!modelPath?.trim()) {
			throw new Error("Select a Whisper model or download the small model first.");
		}
		const resolved = path.resolve(modelPath.trim());
		await ensureReadableFile(resolved);
		return resolved;
	}

	async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
		const whisperExecutablePath = await this.resolveExecutable(request.executablePath);
		const whisperModelPath = await this.validateModel(request.modelPath);

		const tempBase = path.join(
			app.getPath("temp"),
			`recordly-whisper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		);
		const outputBase = `${tempBase}-whisper`;
		const srtPath = `${outputBase}.srt`;
		const jsonPath = `${outputBase}.json`;

		try {
			const language =
				request.language && request.language.trim() ? request.language.trim() : "auto";
			const whisperBaseArgs = [
				"-m",
				whisperModelPath,
				"-f",
				request.audioWavPath,
				"-osrt",
				"-of",
				outputBase,
				"-l",
				language,
				"-np",
			];

			let jsonEnabled = true;
			try {
				await execFileAsync(whisperExecutablePath, [...whisperBaseArgs, "-ojf"], {
					timeout: 30 * 60 * 1000,
					maxBuffer: 20 * 1024 * 1024,
				});
			} catch (error) {
				if (isMissingWindowsWhisperRuntimeDependency(error)) {
					throw new Error(
						"Whisper could not start because the Microsoft Visual C++ x64 Redistributable is missing. Install it from https://aka.ms/vc14/vc_redist.x64.exe, then restart Recordly.",
					);
				}

				if (!shouldRetryWhisperWithoutJson(error)) {
					throw error;
				}

				jsonEnabled = false;
				console.warn(
					"[auto-captions] Whisper runtime does not support JSON full output, retrying with SRT only:",
					error,
				);
				await execFileAsync(whisperExecutablePath, whisperBaseArgs, {
					timeout: 30 * 60 * 1000,
					maxBuffer: 20 * 1024 * 1024,
				});
			}

			const timedCues = jsonEnabled
				? parseWhisperJsonCues(await fs.readFile(jsonPath, "utf-8").catch(() => ""))
				: [];

			const cues =
				timedCues.length > 0
					? timedCues
					: parseSrtCues(await fs.readFile(srtPath, "utf-8").catch(() => ""));

			if (cues.length === 0) {
				throw new Error("Whisper completed, but no caption cues were produced.");
			}

			return { cues, engine: "whisper" };
		} finally {
			await Promise.allSettled([
				fs.rm(srtPath, { force: true }),
				fs.rm(jsonPath, { force: true }),
			]);
		}
	}
}

export class ParakeetEngineAdapter implements ITranscriptionEngine {
	readonly id = "parakeet" as const;
	readonly name = "NVIDIA Parakeet-TDT (sherpa-onnx)";

	async resolveExecutable(preferredPath?: string | null): Promise<string> {
		const exePath = await resolveSherpaOnnxExecutablePath(preferredPath);
		await ensureReadableFile(exePath, { executable: true });
		return exePath;
	}

	async validateModel(modelPath?: string | null): Promise<string> {
		const resolved = await resolveParakeetModelFiles(modelPath);
		return resolved.modelDir;
	}

	async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
		const sherpaExecutablePath = await this.resolveExecutable(request.executablePath);
		const modelFiles = await resolveParakeetModelFiles(request.modelPath);

		const args = [
			`--encoder=${modelFiles.encoderPath}`,
			`--decoder=${modelFiles.decoderPath}`,
			`--joiner=${modelFiles.joinerPath}`,
			`--tokens=${modelFiles.tokensPath}`,
			"--num-threads=4",
			"--decoding-method=greedy_search",
			request.audioWavPath,
		];

		let stdout = "";
		try {
			const result = await execFileAsync(sherpaExecutablePath, args, {
				timeout: 30 * 60 * 1000,
				maxBuffer: 30 * 1024 * 1024,
			});
			stdout = result.stdout ?? "";
		} catch (error) {
			if (isMissingWindowsWhisperRuntimeDependency(error)) {
				throw new Error(
					"sherpa-onnx could not start because a required C++ / ONNX runtime dependency is missing.",
				);
			}
			throw error;
		}

		const cues = parseParakeetJsonOutput(stdout);
		if (cues.length === 0) {
			throw new Error("Parakeet-TDT completed, but no caption cues were produced.");
		}

		return { cues, engine: "parakeet" };
	}
}

export function getTranscriptionEngine(
	engine: CaptionEngineType = "whisper",
): ITranscriptionEngine {
	if (engine === "parakeet") {
		return new ParakeetEngineAdapter();
	}
	return new WhisperEngineAdapter();
}
