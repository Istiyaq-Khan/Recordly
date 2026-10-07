import { describe, expect, it } from "vitest";
import {
	isSupportedDubbingLanguage,
	resolveFloresLanguageCode,
	SUPPORTED_DUBBING_LANGUAGES,
} from "./nllbLanguages";

describe("NLLB Languages and Flores-200 Mapping", () => {
	it("contains major languages in SUPPORTED_DUBBING_LANGUAGES", () => {
		expect(SUPPORTED_DUBBING_LANGUAGES.length).toBeGreaterThan(20);

		const codes = SUPPORTED_DUBBING_LANGUAGES.map((l) => l.code);
		expect(codes).toContain("en");
		expect(codes).toContain("es");
		expect(codes).toContain("fr");
		expect(codes).toContain("de");
		expect(codes).toContain("ja");
		expect(codes).toContain("zh");
		expect(codes).toContain("hi");
		expect(codes).toContain("bn");
	});

	it("resolves exact 2-letter codes to correct Flores-200 codes", () => {
		expect(resolveFloresLanguageCode("es")).toBe("spa_Latn");
		expect(resolveFloresLanguageCode("fr")).toBe("fra_Latn");
		expect(resolveFloresLanguageCode("de")).toBe("deu_Latn");
		expect(resolveFloresLanguageCode("ja")).toBe("jpn_Jpan");
		expect(resolveFloresLanguageCode("zh")).toBe("zho_Hans");
		expect(resolveFloresLanguageCode("bn")).toBe("ben_Beng");
		expect(resolveFloresLanguageCode("hi")).toBe("hin_Deva");
		expect(resolveFloresLanguageCode("en")).toBe("eng_Latn");
	});

	it("falls back to English (eng_Latn) for unknown languages", () => {
		expect(resolveFloresLanguageCode("unknown-lang")).toBe("eng_Latn");
		expect(resolveFloresLanguageCode("")).toBe("eng_Latn");
	});

	it("correctly identifies supported languages", () => {
		expect(isSupportedDubbingLanguage("es")).toBe(true);
		expect(isSupportedDubbingLanguage("ja")).toBe(true);
		expect(isSupportedDubbingLanguage("klingon")).toBe(false);
	});
});
