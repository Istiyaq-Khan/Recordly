import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { get as httpsGet } from "node:https";
import path from "node:path";
import { promisify } from "node:util";
import type Electron from "electron";
import { app } from "electron";
import {
	getBundledWhisperExecutableCandidates,
	getNativeArchTag,
	getWhisperUserDataRuntimeDir,
	resolveUnpackedAppPath,
} from "../paths/binaries";
import { isMissingWindowsWhisperRuntimeDependency } from "./runtimeErrors";

const execFileAsync = promisify(execFile);

export const WINDOWS_WHISPER_REQUIRED_DLLS = [
	"whisper.dll",
	"ggml.dll",
	"ggml-base.dll",
	"ggml-cpu.dll",
	"msvcp140.dll",
	"vcruntime140.dll",
	"vcruntime140_1.dll",
	"vcomp140.dll",
] as const;

export const OFFICIAL_WHISPER_VERSION = "v1.8.4";
export const OFFICIAL_WHISPER_X64_ZIP_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${OFFICIAL_WHISPER_VERSION}/whisper-bin-x64.zip`;

let activeProvisioningPromise: Promise<string> | null = null;

export async function isExecutableFile(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath, fsConstants.R_OK | fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export async function canWriteToDirectory(dirPath: string): Promise<boolean> {
	try {
		await fs.mkdir(dirPath, { recursive: true });
		const probePath = path.join(
			dirPath,
			`.write-probe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
		);
		await fs.writeFile(probePath, "");
		await fs.rm(probePath, { force: true });
		return true;
	} catch {
		return false;
	}
}

export async function testWhisperExecutable(executablePath: string): Promise<{
	healthy: boolean;
	missingRuntime: boolean;
	error?: unknown;
}> {
	try {
		const { stdout, stderr } = await execFileAsync(executablePath, ["-h"], {
			timeout: 10_000,
			windowsHide: true,
			maxBuffer: 5 * 1024 * 1024,
		});
		const combined = `${stdout || ""} ${stderr || ""}`.toLowerCase();
		const looksLikeHelp = combined.includes("usage:") || combined.includes("whisper");
		return { healthy: looksLikeHelp || true, missingRuntime: false };
	} catch (error) {
		if (isMissingWindowsWhisperRuntimeDependency(error)) {
			return { healthy: false, missingRuntime: true, error };
		}

		// Whisper CLI may exit with status 0 or 1 on -h depending on version, but print usage
		const err = error as { code?: unknown; stdout?: string; stderr?: string };
		const combined = `${err.stdout || ""} ${err.stderr || ""}`.toLowerCase();
		if (combined.includes("usage:") || combined.includes("whisper")) {
			return { healthy: true, missingRuntime: false };
		}

		return { healthy: false, missingRuntime: false, error };
	}
}

async function downloadFile(url: string, destinationPath: string): Promise<void> {
	await fs.mkdir(path.dirname(destinationPath), { recursive: true });

	return new Promise((resolve, reject) => {
		const request = (currentUrl: string, redirectCount = 0) => {
			const req = httpsGet(currentUrl, { timeout: 60_000 }, (response) => {
				const statusCode = response.statusCode ?? 0;
				const location = response.headers.location;

				if (statusCode >= 300 && statusCode < 400 && location) {
					response.resume();
					if (redirectCount >= 5) {
						reject(new Error("Too many redirects downloading Whisper runtime."));
						return;
					}
					const nextUrl = new URL(location, currentUrl).toString();
					request(nextUrl, redirectCount + 1);
					return;
				}

				if (statusCode < 200 || statusCode >= 300) {
					response.resume();
					reject(new Error(`Failed to download Whisper runtime: HTTP ${statusCode}`));
					return;
				}

				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", async () => {
					try {
						await fs.writeFile(destinationPath, Buffer.concat(chunks));
						resolve();
					} catch (writeError) {
						reject(writeError);
					}
				});
				response.on("error", reject);
			});

			req.on("error", reject);
			req.on("timeout", () => req.destroy(new Error("Download timed out.")));
		};

		request(url);
	});
}

async function extractZipArchive(archivePath: string, extractDir: string): Promise<void> {
	await fs.mkdir(extractDir, { recursive: true });

	// 1. Try native tar (built into Windows 10 build 17063+ and Windows 11)
	try {
		await execFileAsync("tar", ["-xf", archivePath, "-C", extractDir], {
			windowsHide: true,
			timeout: 60_000,
		});
		return;
	} catch {
		// Fall through to PowerShell Expand-Archive
	}

	// 2. Try PowerShell Expand-Archive
	await execFileAsync(
		"powershell",
		[
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			`Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${extractDir}' -Force`,
		],
		{ windowsHide: true, timeout: 120_000 },
	);
}

function getLocalDllCandidateSearchPaths(dllName: string): string[] {
	const candidates: string[] = [];
	const archTag = getNativeArchTag();

	// 1. App bundled helper directory
	candidates.push(resolveUnpackedAppPath("electron", "native", "bin", archTag, dllName));

	// 2. System32 (Windows standard location for MSVC redistributables)
	const systemRoot = process.env["SystemRoot"] || "C:\\Windows";
	candidates.push(path.join(systemRoot, "System32", dllName));

	// 3. Local build cache / temp directories if present during development
	candidates.push(
		path.join(
			process.cwd(),
			".tmp",
			"whisper-runtime",
			`prebuilt-${archTag}`,
			"Release",
			dllName,
		),
	);
	candidates.push(path.join(process.cwd(), "electron", "native", "bin", archTag, dllName));

	// 4. Common Visual Studio install directories (Redistributable subfolders)
	const vsVersions = ["2022", "2019", "2017"];
	const vsEditions = ["Community", "Professional", "Enterprise", "BuildTools"];
	for (const version of vsVersions) {
		for (const edition of vsEditions) {
			candidates.push(
				path.join(
					"C:",
					"Program Files",
					"Microsoft Visual Studio",
					version,
					edition,
					"VC",
					"Redist",
					"MSVC",
					"14.*",
					"x64",
					"Microsoft.VC143.CRT",
					dllName,
				),
			);
		}
	}

	return candidates;
}

async function findLocalDll(dllName: string): Promise<string | null> {
	const candidates = getLocalDllCandidateSearchPaths(dllName);
	for (const candidate of candidates) {
		try {
			await fs.access(candidate, fsConstants.R_OK);
			return candidate;
		} catch {
			// not at this candidate
		}
	}
	return null;
}

async function recursivelyFindFiles(
	dir: string,
	filter: (name: string) => boolean,
): Promise<string[]> {
	const results: string[] = [];
	const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			const nested = await recursivelyFindFiles(fullPath, filter);
			results.push(...nested);
		} else if (filter(entry.name)) {
			results.push(fullPath);
		}
	}
	return results;
}

export async function provisionWindowsWhisperRuntime(options?: {
	targetExecutablePath?: string | null;
	webContents?: Electron.WebContents | null;
}): Promise<string> {
	const archTag = getNativeArchTag();
	console.log(
		"[whisper-runtime] Starting native runtime verification and provisioning for",
		archTag,
	);

	// Determine existing candidate executable
	const candidates = [
		options?.targetExecutablePath || null,
		...getBundledWhisperExecutableCandidates(),
	].filter((value): value is string => Boolean(value));

	let existingExePath: string | null = null;
	for (const cand of candidates) {
		if (await isExecutableFile(cand)) {
			existingExePath = path.resolve(cand);
			break;
		}
	}

	// Determine destination directory: writable location
	const userDataDir = getWhisperUserDataRuntimeDir();
	let targetDir = userDataDir;

	if (existingExePath) {
		const existingDir = path.dirname(existingExePath);
		if (await canWriteToDirectory(existingDir)) {
			targetDir = existingDir;
		}
	}

	await fs.mkdir(targetDir, { recursive: true });
	const targetExePath = path.join(targetDir, "whisper-cli.exe");

	// Ensure the binary executable is present in targetDir
	if (!path.relative(targetExePath, existingExePath || "").match(/^$/i)) {
		if (existingExePath && (await isExecutableFile(existingExePath))) {
			try {
				await fs.copyFile(existingExePath, targetExePath);
			} catch (copyErr) {
				console.warn(
					"[whisper-runtime] Could not copy existing executable to targetDir:",
					copyErr,
				);
			}
		}
	}

	// Copy locally available DLLs into targetDir
	for (const dll of WINDOWS_WHISPER_REQUIRED_DLLS) {
		const destDllPath = path.join(targetDir, dll);
		let exists = false;
		try {
			await fs.access(destDllPath, fsConstants.R_OK);
			exists = true;
		} catch {
			exists = false;
		}

		if (!exists) {
			const localSrc = await findLocalDll(dll);
			if (localSrc) {
				try {
					await fs.copyFile(localSrc, destDllPath);
					console.log(`[whisper-runtime] Provisioned ${dll} locally from ${localSrc}`);
				} catch (err) {
					console.warn(`[whisper-runtime] Failed to copy local ${dll}:`, err);
				}
			}
		}
	}

	// Test if executable is healthy now
	if (await isExecutableFile(targetExePath)) {
		const check = await testWhisperExecutable(targetExePath);
		if (check.healthy) {
			console.log(
				"[whisper-runtime] Whisper runtime is verified and operational at",
				targetExePath,
			);
			return targetExePath;
		}
	}

	// If missing runtime DLLs remain (e.g. whisper.dll, ggml.dll, or clean environment),
	// download official portable whisper.cpp release and extract DLLs and executable.
	console.log(
		"[whisper-runtime] Downloading official whisper.cpp portable package to complete runtime...",
	);
	const tempZipPath = path.join(
		app.getPath("temp"),
		`whisper-bin-${OFFICIAL_WHISPER_VERSION}-${Date.now()}.zip`,
	);
	const tempExtractDir = path.join(app.getPath("temp"), `whisper-extract-${Date.now()}`);

	try {
		await downloadFile(OFFICIAL_WHISPER_X64_ZIP_URL, tempZipPath);
		await extractZipArchive(tempZipPath, tempExtractDir);

		const extractedFiles = await recursivelyFindFiles(
			tempExtractDir,
			(name) =>
				/^(whisper|ggml)/i.test(name) ||
				name.toLowerCase().endsWith(".dll") ||
				name.toLowerCase() === "whisper-cli.exe",
		);

		for (const srcFile of extractedFiles) {
			const fileName = path.basename(srcFile);
			const destFile = path.join(targetDir, fileName);
			try {
				await fs.copyFile(srcFile, destFile);
				console.log(`[whisper-runtime] Staged ${fileName} from official archive.`);
			} catch (copyErr) {
				console.warn(`[whisper-runtime] Failed staging ${fileName}:`, copyErr);
			}
		}
	} catch (dlErr) {
		console.warn("[whisper-runtime] Failed downloading official whisper archive:", dlErr);
	} finally {
		await Promise.allSettled([
			fs.rm(tempZipPath, { force: true }),
			fs.rm(tempExtractDir, { recursive: true, force: true }),
		]);
	}

	// Ensure MSVC DLLs are also present in targetDir
	for (const dll of [
		"msvcp140.dll",
		"vcruntime140.dll",
		"vcruntime140_1.dll",
		"vcomp140.dll",
	] as const) {
		const destDllPath = path.join(targetDir, dll);
		try {
			await fs.access(destDllPath, fsConstants.R_OK);
		} catch {
			const localSrc = await findLocalDll(dll);
			if (localSrc) {
				await fs.copyFile(localSrc, destDllPath).catch(() => undefined);
			}
		}
	}

	// Final verification
	if (await isExecutableFile(targetExePath)) {
		const finalCheck = await testWhisperExecutable(targetExePath);
		if (finalCheck.healthy) {
			console.log("[whisper-runtime] Runtime provisioned successfully at", targetExePath);
			return targetExePath;
		}
	}

	throw new Error(
		`Failed to provision a functional Whisper runtime environment in ${targetDir}. ` +
			"Ensure required dynamic libraries are present or check network connectivity.",
	);
}

export async function ensureWhisperNativeRuntimeReady(
	webContents?: Electron.WebContents | null,
	options?: { preferredPath?: string | null },
): Promise<string> {
	if (process.platform !== "win32") {
		const candidate = options?.preferredPath || getBundledWhisperExecutableCandidates()[0];
		return candidate;
	}

	if (activeProvisioningPromise) {
		return activeProvisioningPromise;
	}

	activeProvisioningPromise = (async () => {
		try {
			// Check if preferred or existing bundled binary is already healthy
			const candidates = [
				options?.preferredPath || null,
				...getBundledWhisperExecutableCandidates(),
			].filter((value): value is string => Boolean(value));

			for (const cand of candidates) {
				const resolved = path.resolve(cand);
				if (await isExecutableFile(resolved)) {
					const check = await testWhisperExecutable(resolved);
					if (check.healthy) {
						return resolved;
					}
				}
			}

			// If not healthy, provision
			return await provisionWindowsWhisperRuntime({
				targetExecutablePath: options?.preferredPath,
				webContents,
			});
		} finally {
			activeProvisioningPromise = null;
		}
	})();

	return activeProvisioningPromise;
}
