// Common NTSTATUS exit codes associated with missing DLLs or loader failure:
// - 0xC0000135 (-1073741515 / 3221225781): STATUS_DLL_NOT_FOUND
// - 0xC000007B (-1073741701 / 3221225595): STATUS_INVALID_IMAGE_FORMAT (wrong arch or corrupt DLL)
// - 0xC0000139 (-1073741511 / 3221225785): STATUS_ENTRYPOINT_NOT_FOUND
// - 0xC0000142 (-1073741502 / 3221225794): STATUS_DLL_INIT_FAILED
const WINDOWS_MISSING_RUNTIME_EXIT_CODES = new Set([
	-1073741515, 3221225781, -1073741701, 3221225595, -1073741511, 3221225785, -1073741502,
	3221225794,
]);

export function isMissingWindowsWhisperRuntimeDependency(error: unknown) {
	if (process.platform !== "win32" || !error || typeof error !== "object") {
		return false;
	}

	const code = (error as { code?: unknown }).code;
	if (typeof code === "number" && WINDOWS_MISSING_RUNTIME_EXIT_CODES.has(code)) {
		return true;
	}

	const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
	const stderr = String((error as { stderr?: unknown }).stderr ?? "").toLowerCase();
	const combined = `${message} ${stderr}`;

	return (
		combined.includes("0xc0000135") ||
		combined.includes("status_dll_not_found") ||
		combined.includes("msvcp140.dll") ||
		combined.includes("vcruntime140.dll") ||
		combined.includes("whisper.dll") ||
		combined.includes("ggml.dll")
	);
}
