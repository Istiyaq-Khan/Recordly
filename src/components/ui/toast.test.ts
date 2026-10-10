import { afterEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() =>
	Object.assign(
		vi.fn(() => "toast-key"),
		{
			success: vi.fn(),
			danger: vi.fn(),
			update: vi.fn(() => "toast-key"),
			clear: vi.fn(),
			close: vi.fn(),
		},
	),
);
vi.mock("@heroui/react", () => ({ Toast: { Provider: () => null }, toast: native }));

import { copyTextToClipboard, plainText, toast } from "./toast";

afterEach(() => {
	toast.dismiss();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

it("copies the error title and details through the native action via electronAPI", async () => {
	const writeClipboardText = vi.fn().mockResolvedValue({ success: true });
	vi.stubGlobal("window", { electronAPI: { writeClipboardText } });
	toast.error("Export failed", { description: "Encoder unavailable" });
	const options = (
		native.mock.calls as unknown as [
			string,
			{ variant: string; actionProps: { children: string; onPress: () => void } },
		][]
	)[0][1];
	expect(options.variant).toBe("danger");
	expect(options.actionProps.children).toBe("Copy");
	options.actionProps.onPress();
	await vi.waitFor(() => expect(native.success).toHaveBeenCalledWith("Error copied"));
	expect(writeClipboardText).toHaveBeenCalledWith("Export failed\n\nEncoder unavailable");
});

it("falls back to navigator.clipboard if electronAPI is unavailable", async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	toast.error("Network error", { description: "Request timeout" });
	const options = (
		native.mock.calls as unknown as [
			string,
			{ variant: string; actionProps: { children: string; onPress: () => void } },
		][]
	)[0][1];
	options.actionProps.onPress();
	await vi.waitFor(() => expect(native.success).toHaveBeenCalledWith("Error copied"));
	expect(writeText).toHaveBeenCalledWith("Network error\n\nRequest timeout");
});

it("falls back to document.execCommand when navigator.clipboard fails", async () => {
	const writeText = vi.fn().mockRejectedValue(new Error("Document not focused"));
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	const execCommandMock = vi.fn().mockReturnValue(true);
	const appendChildMock = vi.fn();
	const removeChildMock = vi.fn();
	const dummyTextarea = {
		style: {},
		value: "",
		focus: vi.fn(),
		select: vi.fn(),
	};
	vi.stubGlobal("document", {
		createElement: vi.fn(() => dummyTextarea),
		body: {
			appendChild: appendChildMock,
			removeChild: removeChildMock,
		},
		execCommand: execCommandMock,
	});

	const success = await copyTextToClipboard("Direct test error");
	expect(success).toBe(true);
	expect(execCommandMock).toHaveBeenCalledWith("copy");
	expect(dummyTextarea.value).toBe("Direct test error");
});

it("serializes Error instances and complex objects in plainText", () => {
	const err = new Error("Custom error message");
	expect(plainText(err)).toContain("Custom error message");

	const obj = { code: "ERR_CLONE", reason: "Blocked" };
	expect(plainText(obj)).toContain("ERR_CLONE");
});

it("preserves explicit actions and updates named notifications", () => {
	const onClick = vi.fn();
	toast.error("Retry", { id: "job", action: { label: "Retry", onClick } });
	toast.success("Done", { id: "job" });
	expect(native.update).toHaveBeenCalledWith(
		"toast-key",
		"Done",
		expect.objectContaining({ variant: "success" }),
	);
	expect(native).toHaveBeenCalledWith(
		"Retry",
		expect.objectContaining({ actionProps: { children: "Retry", onPress: onClick } }),
	);
});
