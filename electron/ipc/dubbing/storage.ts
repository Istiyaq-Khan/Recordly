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
