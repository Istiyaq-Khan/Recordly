import { toast as heroToast, Toast } from "@heroui/react";
import { isValidElement, type ReactNode } from "react";

type Options = {
	id?: string | number;
	description?: ReactNode;
	duration?: number;
	action?: { label: ReactNode; onClick: () => void };
	onDismiss?: () => void;
};
type Variant = "default" | "accent" | "success" | "warning" | "danger";
const ids = new Map<string | number, string>();

export function plainText(value: unknown): string {
	if (value instanceof Error) {
		return value.stack || value.message;
	}
	if (typeof value === "string" || typeof value === "number") return String(value);
	if (Array.isArray(value)) return value.map(plainText).join("");
	if (isValidElement<{ children?: ReactNode }>(value)) return plainText(value.props.children);
	if (value && typeof value === "object") {
		try {
			return JSON.stringify(value, Object.getOwnPropertyNames(value));
		} catch {
			return String(value);
		}
	}
	return "";
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
	// Tier 1: Electron native clipboard (immune to window focus restrictions)
	if (
		typeof window !== "undefined" &&
		typeof window.electronAPI?.writeClipboardText === "function"
	) {
		try {
			const res = await window.electronAPI.writeClipboardText(text);
			if (res?.success) return true;
		} catch {
			// fallback
		}
	}
	// Tier 2: Navigator clipboard
	if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// fallback
		}
	}
	// Tier 3: Legacy textarea execCommand
	if (typeof document !== "undefined") {
		try {
			const textarea = document.createElement("textarea");
			textarea.value = text;
			textarea.style.position = "fixed";
			textarea.style.opacity = "0";
			document.body.appendChild(textarea);
			textarea.focus();
			textarea.select();
			const success = document.execCommand("copy");
			document.body.removeChild(textarea);
			if (success) return true;
		} catch {
			// complete failure
		}
	}
	return false;
}

// Keep existing callers compatible while HeroUI owns the queue and presentation.
function notify(title: ReactNode, options: Options = {}, variant: Variant = "default") {
	const errorText = [plainText(title), plainText(options.description)]
		.filter(Boolean)
		.join("\n\n");
	const action = options.action;
	const nativeOptions = {
		variant,
		description: options.description,
		timeout:
			options.duration === Infinity
				? 0
				: (options.duration ?? (variant === "danger" ? 8000 : 4000)),
		onClose: () => {
			if (options.id !== undefined) ids.delete(options.id);
			options.onDismiss?.();
		},
		actionProps: action
			? {
					children: action.label,
					onPress: action.onClick,
				}
			: variant === "danger" && errorText
				? {
						children: "Copy",
						onPress: () => {
							void copyTextToClipboard(errorText).then((success) => {
								if (success) {
									heroToast.success("Error copied");
								} else {
									heroToast.danger("Could not copy error", {
										description: errorText,
									});
								}
							});
						},
					}
				: undefined,
	};
	const previous = options.id === undefined ? undefined : ids.get(options.id);
	const key = previous
		? heroToast.update(previous, title, nativeOptions)
		: heroToast(title, nativeOptions);
	if (options.id !== undefined) ids.set(options.id, key);
	return key;
}
export const toast = Object.assign(notify, {
	success: (message: ReactNode, options?: Options) => notify(message, options, "success"),
	error: (message: ReactNode, options?: Options) => notify(message, options, "danger"),
	info: (message: ReactNode, options?: Options) => notify(message, options, "accent"),
	warning: (message: ReactNode, options?: Options) => notify(message, options, "warning"),
	dismiss: (id?: string | number) => {
		if (id === undefined) {
			heroToast.clear();
			ids.clear();
		} else heroToast.close(ids.get(id) ?? String(id));
	},
});
export function Toaster({ className }: { className?: string }) {
	return <Toast.Provider placement="bottom end" className={className} />;
}
