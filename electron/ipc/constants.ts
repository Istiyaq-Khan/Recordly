import path from "node:path";
import { USER_DATA_PATH } from "../appPaths";

export const PROJECT_FILE_EXTENSION = "recordly";
export const LEGACY_PROJECT_FILE_EXTENSIONS = ["openscreen"];
export const PROJECTS_DIRECTORY_NAME = "Projects";
export const PROJECT_THUMBNAIL_SUFFIX = ".preview.png";
export const RECENT_PROJECTS_FILE = path.join(USER_DATA_PATH, "recent-projects.json");
export const MAX_RECENT_PROJECTS = 16;
export const SHORTCUTS_FILE = path.join(USER_DATA_PATH, "shortcuts.json");
export const RECORDINGS_SETTINGS_FILE = path.join(USER_DATA_PATH, "recordings-settings.json");
export const COUNTDOWN_SETTINGS_FILE = path.join(USER_DATA_PATH, "countdown-settings.json");
export const APP_SETTINGS_FILE = path.join(USER_DATA_PATH, "app-settings.json");
export const AUTO_RECORDING_PREFIX = "recording-";
export const AUTO_RECORDING_RETENTION_COUNT = 20;
export const AUTO_RECORDING_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const ALLOW_RECORDLY_WINDOW_CAPTURE = Boolean(process.env["VITE_DEV_SERVER_URL"]);
export const RECORDING_SESSION_MANIFEST_SUFFIX = ".recordly-session.json";
export const WHISPER_MODEL_DOWNLOAD_URL =
	"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";
export const WHISPER_MODEL_DIR = path.join(USER_DATA_PATH, "whisper");
export const WHISPER_SMALL_MODEL_PATH = path.join(WHISPER_MODEL_DIR, "ggml-small.bin");
export const PARAKEET_MODEL_DOWNLOAD_BASE_URL =
	"https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/main";
export const PARAKEET_MODEL_DIR = path.join(USER_DATA_PATH, "parakeet");
export const PARAKEET_MODEL_FILES = [
	"encoder.int8.onnx",
	"decoder.int8.onnx",
	"joiner.int8.onnx",
	"tokens.txt",
] as const;

export const SHERPA_ONNX_RELEASE_VERSION = "v1.13.7";
export const SHERPA_ONNX_RELEASE_BASE_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_ONNX_RELEASE_VERSION}`;

export interface SherpaOnnxBinaryAsset {
	archiveName: string;
	url: string;
	binaryName: string;
	extractedSubdir: string;
}

export const SHERPA_ONNX_RUNTIME_ASSETS: Record<string, SherpaOnnxBinaryAsset> = {
	"win32-x64": {
		archiveName: "sherpa-onnx-v1.13.7-win-x64-shared-MT-Release.tar.bz2",
		url: `${SHERPA_ONNX_RELEASE_BASE_URL}/sherpa-onnx-v1.13.7-win-x64-shared-MT-Release.tar.bz2`,
		binaryName: "sherpa-onnx-offline.exe",
		extractedSubdir: "sherpa-onnx-v1.13.7-win-x64-shared-MT-Release",
	},
	"win32-arm64": {
		archiveName: "sherpa-onnx-v1.13.7-win-arm64-shared-MT-Release.tar.bz2",
		url: `${SHERPA_ONNX_RELEASE_BASE_URL}/sherpa-onnx-v1.13.7-win-arm64-shared-MT-Release.tar.bz2`,
		binaryName: "sherpa-onnx-offline.exe",
		extractedSubdir: "sherpa-onnx-v1.13.7-win-arm64-shared-MT-Release",
	},
	"darwin-x64": {
		archiveName: "sherpa-onnx-v1.13.7-osx-universal2-shared.tar.bz2",
		url: `${SHERPA_ONNX_RELEASE_BASE_URL}/sherpa-onnx-v1.13.7-osx-universal2-shared.tar.bz2`,
		binaryName: "sherpa-onnx-offline",
		extractedSubdir: "sherpa-onnx-v1.13.7-osx-universal2-shared",
	},
	"darwin-arm64": {
		archiveName: "sherpa-onnx-v1.13.7-osx-universal2-shared.tar.bz2",
		url: `${SHERPA_ONNX_RELEASE_BASE_URL}/sherpa-onnx-v1.13.7-osx-universal2-shared.tar.bz2`,
		binaryName: "sherpa-onnx-offline",
		extractedSubdir: "sherpa-onnx-v1.13.7-osx-universal2-shared",
	},
	"linux-x64": {
		archiveName: "sherpa-onnx-v1.13.7-linux-x64-shared.tar.bz2",
		url: `${SHERPA_ONNX_RELEASE_BASE_URL}/sherpa-onnx-v1.13.7-linux-x64-shared.tar.bz2`,
		binaryName: "sherpa-onnx-offline",
		extractedSubdir: "sherpa-onnx-v1.13.7-linux-x64-shared",
	},
	"linux-arm64": {
		archiveName: "sherpa-onnx-v1.13.7-linux-aarch64-shared-cpu.tar.bz2",
		url: `${SHERPA_ONNX_RELEASE_BASE_URL}/sherpa-onnx-v1.13.7-linux-aarch64-shared-cpu.tar.bz2`,
		binaryName: "sherpa-onnx-offline",
		extractedSubdir: "sherpa-onnx-v1.13.7-linux-aarch64-shared-cpu",
	},
};

export const SHERPA_ONNX_RUNTIME_DIR = path.join(USER_DATA_PATH, "runtime", "sherpa-onnx");
export const COMPANION_AUDIO_LAYOUTS = [
	{ platform: "mac" as const, systemSuffix: ".system.m4a", micSuffix: ".mic.m4a" },
	{ platform: "win" as const, systemSuffix: ".system.wav", micSuffix: ".mic.wav" },
	{ platform: "mac" as const, systemSuffix: ".system.webm", micSuffix: ".mic.webm" },
];

export const CURSOR_TELEMETRY_VERSION = 2;
export const CURSOR_SAMPLE_INTERVAL_MS = 33;
export const MAX_CURSOR_SAMPLES = 60 * 60 * 30; // 1 hour @ 30Hz
