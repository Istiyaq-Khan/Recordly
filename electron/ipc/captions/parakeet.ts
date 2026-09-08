import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { get as httpsGet } from "node:https";
import path from "node:path";
import type Electron from "electron";
import {
	PARAKEET_MODEL_DIR,
	PARAKEET_MODEL_DOWNLOAD_BASE_URL,
	PARAKEET_MODEL_FILES,
} from "../constants";
import type { ParakeetModelDownloadProgress, ParakeetModelStatus } from "../types";

export interface ResolvedParakeetModelPaths {
	encoderPath: string;
	decoderPath: string;
	joinerPath: string;
	tokensPath: string;
	modelDir: string;
}

export function sendParakeetModelDownloadProgress(
	webContents: Electron.WebContents,
	payload: ParakeetModelDownloadProgress,
) {
	webContents.send("parakeet-model-download-progress", payload);
}

/**
 * Given a directory or any model file path within a directory, resolve the 4
 * required Parakeet TDT ONNX model components: encoder, decoder, joiner, tokens.
 */
export async function resolveParakeetModelFiles(
	modelDirOrFilePath?: string | null,
): Promise<ResolvedParakeetModelPaths> {
	const targetPath = (modelDirOrFilePath?.trim() || PARAKEET_MODEL_DIR).trim();
	const stats = await fs.stat(targetPath).catch(() => null);
	if (!stats) {
		throw new Error(
			`Parakeet model path does not exist: "${targetPath}". Please download the model or select a valid folder.`,
		);
	}

	const modelDir = stats.isDirectory() ? targetPath : path.dirname(targetPath);
	const dirEntries = await fs.readdir(modelDir);

	const findMatch = (pattern: RegExp) => {
		const match = dirEntries.find((name) => pattern.test(name));
		return match ? path.join(modelDir, match) : null;
	};

	const encoderPath = findMatch(/^encoder.*\.onnx$/i) ?? findMatch(/encoder.*\.onnx$/i);
	const decoderPath = findMatch(/^decoder.*\.onnx$/i) ?? findMatch(/decoder.*\.onnx$/i);
	const joinerPath = findMatch(/^joiner.*\.onnx$/i) ?? findMatch(/joiner.*\.onnx$/i);
	const tokensPath = findMatch(/^tokens.*\.txt$/i) ?? findMatch(/tokens.*\.txt$/i);

	const missing: string[] = [];
	if (!encoderPath) missing.push("encoder.onnx / encoder.int8.onnx");
	if (!decoderPath) missing.push("decoder.onnx / decoder.int8.onnx");
	if (!joinerPath) missing.push("joiner.onnx / joiner.int8.onnx");
	if (!tokensPath) missing.push("tokens.txt");

	if (missing.length > 0) {
		throw new Error(
			`Incomplete Parakeet model in "${modelDir}". Missing: ${missing.join(", ")}.`,
		);
	}

	return {
		encoderPath: encoderPath!,
		decoderPath: decoderPath!,
		joinerPath: joinerPath!,
		tokensPath: tokensPath!,
		modelDir,
	};
}

export async function getParakeetModelStatus(): Promise<ParakeetModelStatus> {
	try {
		await resolveParakeetModelFiles(PARAKEET_MODEL_DIR);
		return {
			success: true,
			exists: true,
			path: PARAKEET_MODEL_DIR,
		};
	} catch (error) {
		return {
			success: true,
			exists: false,
			path: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function downloadSingleFile(
	url: string,
	destinationPath: string,
	onByteChunk: (bytesReceived: number) => void,
): Promise<void> {
	const request = (currentUrl: string, redirectCount = 0): Promise<void> => {
		return new Promise((resolve, reject) => {
			const req = httpsGet(currentUrl, { timeout: 30_000 }, (response) => {
				const statusCode = response.statusCode ?? 0;
				const location = response.headers.location;

				if (statusCode >= 300 && statusCode < 400 && location) {
					response.resume();
					if (redirectCount >= 5) {
						reject(
							new Error("Too many redirects while downloading Parakeet model file."),
						);
						return;
					}
					const nextUrl = new URL(location, currentUrl).toString();
					void request(nextUrl, redirectCount + 1)
						.then(resolve)
						.catch(reject);
					return;
				}

				if (statusCode < 200 || statusCode >= 300) {
					response.resume();
					reject(
						new Error(
							`Download failed with status ${statusCode} for ${path.basename(destinationPath)}`,
						),
					);
					return;
				}

				const fileStream = createWriteStream(destinationPath);
				response.on("data", (chunk: Buffer) => {
					onByteChunk(chunk.length);
				});

				response.on("error", (error) => {
					fileStream.destroy(error);
				});

				fileStream.on("error", (error) => {
					response.destroy(error);
					reject(error);
				});

				fileStream.on("finish", () => {
					resolve();
				});

				response.pipe(fileStream);
			});

			req.on("error", reject);
			req.on("timeout", () => {
				req.destroy(new Error(`Download timed out for ${path.basename(destinationPath)}`));
			});
		});
	};

	return request(url);
}

// Approximate expected file sizes for progress estimation before headers arrive:
// encoder: ~652MB, decoder: ~11.8MB, joiner: ~6.3MB, tokens: ~0.1MB (~670.2 MB total)
const ESTIMATED_TOTAL_BYTES = 670 * 1024 * 1024;

export async function downloadParakeetModel(webContents: Electron.WebContents): Promise<string> {
	const tempDownloadDir = path.join(PARAKEET_MODEL_DIR, ".download");
	await fs.mkdir(tempDownloadDir, { recursive: true });

	sendParakeetModelDownloadProgress(webContents, {
		status: "downloading",
		progress: 0,
		path: null,
	});

	let totalBytesDownloaded = 0;

	try {
		for (const fileName of PARAKEET_MODEL_FILES) {
			const fileUrl = `${PARAKEET_MODEL_DOWNLOAD_BASE_URL}/${fileName}`;
			const destPath = path.join(tempDownloadDir, fileName);

			sendParakeetModelDownloadProgress(webContents, {
				status: "downloading",
				progress: Math.min(
					99,
					Math.round((totalBytesDownloaded / ESTIMATED_TOTAL_BYTES) * 100),
				),
				currentFile: fileName,
				path: null,
			});

			await downloadSingleFile(fileUrl, destPath, (bytesChunk) => {
				totalBytesDownloaded += bytesChunk;
				const percent = Math.min(
					99,
					Math.round((totalBytesDownloaded / ESTIMATED_TOTAL_BYTES) * 100),
				);
				sendParakeetModelDownloadProgress(webContents, {
					status: "downloading",
					progress: percent,
					currentFile: fileName,
					path: null,
				});
			});
		}

		// Move downloaded files to final directory
		for (const fileName of PARAKEET_MODEL_FILES) {
			const tempFile = path.join(tempDownloadDir, fileName);
			const finalFile = path.join(PARAKEET_MODEL_DIR, fileName);
			await fs.rename(tempFile, finalFile);
		}

		await fs.rm(tempDownloadDir, { recursive: true, force: true }).catch(() => undefined);

		sendParakeetModelDownloadProgress(webContents, {
			status: "downloaded",
			progress: 100,
			path: PARAKEET_MODEL_DIR,
		});

		return PARAKEET_MODEL_DIR;
	} catch (error) {
		await fs.rm(tempDownloadDir, { recursive: true, force: true }).catch(() => undefined);
		sendParakeetModelDownloadProgress(webContents, {
			status: "error",
			progress: 0,
			path: null,
			error: String(error),
		});
		throw error;
	}
}

export async function deleteParakeetModel(): Promise<void> {
	await fs.rm(PARAKEET_MODEL_DIR, { recursive: true, force: true });
}
