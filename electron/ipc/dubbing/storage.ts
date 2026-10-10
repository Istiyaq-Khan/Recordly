import { safeStorage } from "electron";
import { readAppSettingsStore, writeAppSettingsStore } from "../../appSettingsStore";

const DUBBING_API_KEY_PREFIX = "dubbing.apiKey.";

export type SupportedApiKeyProvider = "fish-audio" | "acedatacloud" | "openai" | "deepl";

export function saveSecureApiKey(provider: SupportedApiKeyProvider, key: string): boolean {
	try {
		const store = readAppSettingsStore();
		const settingKey = `${DUBBING_API_KEY_PREFIX}${provider}`;
		const trimmed = key.trim();

		if (!trimmed) {
			delete store[settingKey];
			writeAppSettingsStore(store);
			return true;
		}

		if (safeStorage && safeStorage.isEncryptionAvailable()) {
			const encrypted = safeStorage.encryptString(trimmed);
			store[settingKey] = {
				encrypted: true,
				data: encrypted.toString("base64"),
			};
		} else {
			// Fallback if OS safeStorage keyring is unavailable
			store[settingKey] = {
				encrypted: false,
				data: Buffer.from(trimmed, "utf-8").toString("base64"),
			};
		}

		writeAppSettingsStore(store);
		return true;
	} catch (error) {
		console.error(`Failed to store API key for ${provider}:`, error);
		return false;
	}
}

export function getSecureApiKey(provider: SupportedApiKeyProvider): string | null {
	try {
		const store = readAppSettingsStore();
		const settingKey = `${DUBBING_API_KEY_PREFIX}${provider}`;
		const entry = store[settingKey];

		if (!entry || typeof entry !== "object") {
			return null;
		}

		const data = (entry as { data?: string; encrypted?: boolean }).data;
		const isEncrypted = (entry as { encrypted?: boolean }).encrypted;

		if (typeof data !== "string" || !data) {
			return null;
		}

		if (isEncrypted && safeStorage && safeStorage.isEncryptionAvailable()) {
			const buffer = Buffer.from(data, "base64");
			return safeStorage.decryptString(buffer);
		}

		// Decrypt unencrypted fallback
		return Buffer.from(data, "base64").toString("utf-8");
	} catch (error) {
		console.error(`Failed to retrieve API key for ${provider}:`, error);
		return null;
	}
}

export function hasSecureApiKey(provider: SupportedApiKeyProvider): boolean {
	const key = getSecureApiKey(provider);
	return Boolean(key && key.trim().length > 0);
}

const DUBBING_CUSTOM_OPENAI_PREFIX = "dubbing.customOpenAi";

export interface CustomOpenAiConfig {
	baseUrl: string | null;
	model: string | null;
	apiKey?: string | null;
}

export function saveCustomOpenAiConfig(config: {
	baseUrl?: string | null;
	model?: string | null;
	apiKey?: string | null;
}): boolean {
	try {
		const store = readAppSettingsStore();
		store[`${DUBBING_CUSTOM_OPENAI_PREFIX}.baseUrl`] = config.baseUrl?.trim() || null;
		store[`${DUBBING_CUSTOM_OPENAI_PREFIX}.model`] = config.model?.trim() || null;
		if (config.apiKey !== undefined && config.apiKey && config.apiKey.trim()) {
			saveSecureApiKey("openai", config.apiKey.trim());
		}
		writeAppSettingsStore(store);
		return true;
	} catch (error) {
		console.error("Failed to save custom OpenAI config:", error);
		return false;
	}
}

export function getCustomOpenAiConfig(): CustomOpenAiConfig {
	try {
		const store = readAppSettingsStore();
		const baseUrl = store[`${DUBBING_CUSTOM_OPENAI_PREFIX}.baseUrl`];
		const model = store[`${DUBBING_CUSTOM_OPENAI_PREFIX}.model`];
		const apiKey = getSecureApiKey("openai");
		return {
			baseUrl: typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : null,
			model: typeof model === "string" && model.trim() ? model.trim() : null,
			apiKey: apiKey ?? null,
		};
	} catch (error) {
		console.error("Failed to get custom OpenAI config:", error);
		return { baseUrl: null, model: null, apiKey: null };
	}
}
