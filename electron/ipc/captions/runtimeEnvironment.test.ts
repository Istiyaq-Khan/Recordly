import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execFile: vi.fn(),
	access: vi.fn(),
	writeFile: vi.fn(),
	rm: vi.fn(),
	mkdir: vi.fn(),
	copyFile: vi.fn(),
	readdir: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFile: (...args: unknown[]) => {
		const callback = args.pop() as (error: Error | null, result: unknown) => void;
		Promise.resolve()
			.then(() => mocks.execFile(...args))
			.then(
				(result) =>
					callback(
						null,
						result ?? { stdout: "usage: whisper-cli [options]", stderr: "" },
					),
				(error) => callback(error, undefined),
			);
	},
}));

vi.mock("node:fs/promises", () => ({
	default: {
		access: mocks.access,
		writeFile: mocks.writeFile,
		rm: mocks.rm,
		mkdir: mocks.mkdir,
		copyFile: mocks.copyFile,
		readdir: mocks.readdir,
	},
}));

vi.mock("electron", () => ({
	app: {
		getPath: (name: string) => (name === "temp" ? "/temp" : "/userData"),
		getAppPath: () => "/app",
		isPackaged: false,
	},
}));

import {
	canWriteToDirectory,
	ensureWhisperNativeRuntimeReady,
	testWhisperExecutable,
	WINDOWS_WHISPER_REQUIRED_DLLS,
} from "./runtimeEnvironment";

describe("runtimeEnvironment", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.access.mockResolvedValue(undefined);
		mocks.mkdir.mockResolvedValue(undefined);
		mocks.writeFile.mockResolvedValue(undefined);
		mocks.rm.mockResolvedValue(undefined);
		mocks.copyFile.mockResolvedValue(undefined);
		mocks.execFile.mockResolvedValue({ stdout: "usage: whisper [options]", stderr: "" });
	});

	it("defines all critical Windows runtime DLLs for whisper and msvc", () => {
		expect(WINDOWS_WHISPER_REQUIRED_DLLS).toContain("whisper.dll");
		expect(WINDOWS_WHISPER_REQUIRED_DLLS).toContain("ggml.dll");
		expect(WINDOWS_WHISPER_REQUIRED_DLLS).toContain("msvcp140.dll");
		expect(WINDOWS_WHISPER_REQUIRED_DLLS).toContain("vcruntime140.dll");
		expect(WINDOWS_WHISPER_REQUIRED_DLLS).toContain("vcomp140.dll");
	});

	it("reports canWriteToDirectory true when probe file succeeds", async () => {
		const writable = await canWriteToDirectory("/test/dir");
		expect(writable).toBe(true);
		expect(mocks.writeFile).toHaveBeenCalled();
		expect(mocks.rm).toHaveBeenCalled();
	});

	it("reports canWriteToDirectory false when writing fails", async () => {
		mocks.writeFile.mockRejectedValueOnce(new Error("EACCES"));
		const writable = await canWriteToDirectory("/readonly/dir");
		expect(writable).toBe(false);
	});

	it("identifies healthy whisper executables", async () => {
		mocks.execFile.mockResolvedValueOnce({ stdout: "usage: whisper-cli", stderr: "" });
		const result = await testWhisperExecutable("/path/whisper-cli.exe");
		expect(result.healthy).toBe(true);
		expect(result.missingRuntime).toBe(false);
	});

	it("detects missing runtime dependencies on Windows exit code 3221225781", async () => {
		if (process.platform !== "win32") return;
		const missingError = Object.assign(new Error("Command failed"), { code: 3221225781 });
		mocks.execFile.mockRejectedValueOnce(missingError);

		const result = await testWhisperExecutable("/path/whisper-cli.exe");
		expect(result.healthy).toBe(false);
		expect(result.missingRuntime).toBe(true);
	});

	it("returns candidate path when runtime is already healthy", async () => {
		const ready = await ensureWhisperNativeRuntimeReady(null, {
			preferredPath: "/custom/whisper-cli.exe",
		});
		expect(ready).toBeTruthy();
	});
});
