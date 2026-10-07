import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStore: Record<string, unknown> = {};

vi.mock("../../appSettingsStore", () => ({
	readAppSettingsStore: vi.fn(() => ({ ...mockStore })),
	writeAppSettingsStore: vi.fn((newStore) => {
		for (const key of Object.keys(mockStore)) {
			delete mockStore[key];
		}
		Object.assign(mockStore, newStore);
	}),
}));

vi.mock("electron", () => ({
	safeStorage: {
		isEncryptionAvailable: vi.fn(() => true),
		encryptString: vi.fn((str: string) => Buffer.from(`enc_${str}`)),
		decryptString: vi.fn((buf: Buffer) => buf.toString().replace(/^enc_/, "")),
	},
}));

import { getSecureApiKey, hasSecureApiKey, saveSecureApiKey } from "./storage";

describe("Dubbing Secure Storage", () => {
	beforeEach(() => {
		for (const key of Object.keys(mockStore)) {
			delete mockStore[key];
		}
	});

	it("saves and retrieves an encrypted API key", () => {
		expect(hasSecureApiKey("fish-audio")).toBe(false);
		expect(getSecureApiKey("fish-audio")).toBeNull();

		const saved = saveSecureApiKey("fish-audio", "test-fish-key-1234");
		expect(saved).toBe(true);
		expect(hasSecureApiKey("fish-audio")).toBe(true);
		expect(getSecureApiKey("fish-audio")).toBe("test-fish-key-1234");
	});

	it("removes API key when empty string is saved", () => {
		saveSecureApiKey("openai", "sk-proj-test");
		expect(hasSecureApiKey("openai")).toBe(true);

		saveSecureApiKey("openai", "   ");
		expect(hasSecureApiKey("openai")).toBe(false);
		expect(getSecureApiKey("openai")).toBeNull();
	});

	it("supports multiple distinct providers independently", () => {
		saveSecureApiKey("fish-audio", "fish_abc");
		saveSecureApiKey("deepl", "deepl_xyz");

		expect(getSecureApiKey("fish-audio")).toBe("fish_abc");
		expect(getSecureApiKey("deepl")).toBe("deepl_xyz");
		expect(getSecureApiKey("openai")).toBeNull();
	});
});
