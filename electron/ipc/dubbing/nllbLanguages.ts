import type { DubbingLanguage } from "./types";

export const SUPPORTED_DUBBING_LANGUAGES: DubbingLanguage[] = [
	{ code: "en", floresCode: "eng_Latn", name: "English", nativeName: "English" },
	{ code: "es", floresCode: "spa_Latn", name: "Spanish", nativeName: "Español" },
	{ code: "fr", floresCode: "fra_Latn", name: "French", nativeName: "Français" },
	{ code: "de", floresCode: "deu_Latn", name: "German", nativeName: "Deutsch" },
	{ code: "it", floresCode: "ita_Latn", name: "Italian", nativeName: "Italiano" },
	{ code: "pt", floresCode: "por_Latn", name: "Portuguese", nativeName: "Português" },
	{
		code: "pt-BR",
		floresCode: "por_Latn",
		name: "Portuguese (Brazil)",
		nativeName: "Português (Brasil)",
	},
	{ code: "nl", floresCode: "nld_Latn", name: "Dutch", nativeName: "Nederlands" },
	{ code: "hi", floresCode: "hin_Deva", name: "Hindi", nativeName: "हिन्दी" },
	{ code: "bn", floresCode: "ben_Beng", name: "Bengali", nativeName: "বাংলা" },
	{ code: "ja", floresCode: "jpn_Jpan", name: "Japanese", nativeName: "日本語" },
	{ code: "zh", floresCode: "zho_Hans", name: "Chinese (Simplified)", nativeName: "简体中文" },
	{
		code: "zh-TW",
		floresCode: "zho_Hant",
		name: "Chinese (Traditional)",
		nativeName: "繁體中文",
	},
	{ code: "ko", floresCode: "kor_Hang", name: "Korean", nativeName: "한국어" },
	{ code: "ar", floresCode: "arb_Arab", name: "Arabic", nativeName: "العربية" },
	{ code: "ru", floresCode: "rus_Cyrl", name: "Russian", nativeName: "Русский" },
	{ code: "tr", floresCode: "tur_Latn", name: "Turkish", nativeName: "Türkçe" },
	{ code: "vi", floresCode: "vie_Latn", name: "Vietnamese", nativeName: "Tiếng Việt" },
	{ code: "id", floresCode: "ind_Latn", name: "Indonesian", nativeName: "Bahasa Indonesia" },
	{ code: "pl", floresCode: "pol_Latn", name: "Polish", nativeName: "Polski" },
	{ code: "uk", floresCode: "ukr_Cyrl", name: "Ukrainian", nativeName: "Українська" },
	{ code: "th", floresCode: "tha_Thai", name: "Thai", nativeName: "ไทย" },
	{ code: "sv", floresCode: "swe_Latn", name: "Swedish", nativeName: "Svenska" },
	{ code: "el", floresCode: "ell_Grek", name: "Greek", nativeName: "Ελληνικά" },
	{ code: "cs", floresCode: "ces_Latn", name: "Czech", nativeName: "Čeština" },
	{ code: "ro", floresCode: "ron_Latn", name: "Romanian", nativeName: "Română" },
	{ code: "hu", floresCode: "hun_Latn", name: "Hungarian", nativeName: "Magyar" },
	{ code: "da", floresCode: "dan_Latn", name: "Danish", nativeName: "Dansk" },
	{ code: "fi", floresCode: "fin_Latn", name: "Finnish", nativeName: "Suomi" },
	{ code: "no", floresCode: "nob_Latn", name: "Norwegian", nativeName: "Norsk" },
];

export function resolveFloresLanguageCode(languageCode: string): string {
	const normalized = languageCode.trim().toLowerCase();
	const match = SUPPORTED_DUBBING_LANGUAGES.find(
		(l) => l.code.toLowerCase() === normalized || l.floresCode.toLowerCase() === normalized,
	);
	if (match) return match.floresCode;

	// Fallback to Spanish or English if unknown
	if (normalized.startsWith("en")) return "eng_Latn";
	if (normalized.startsWith("es")) return "spa_Latn";
	if (normalized.startsWith("fr")) return "fra_Latn";
	if (normalized.startsWith("de")) return "deu_Latn";
	if (normalized.startsWith("zh")) return "zho_Hans";
	if (normalized.startsWith("bn")) return "ben_Beng";
	if (normalized.startsWith("hi")) return "hin_Deva";
	if (normalized.startsWith("ja")) return "jpn_Jpan";
	if (normalized.startsWith("ko")) return "kor_Hang";
	return "eng_Latn";
}

export function isSupportedDubbingLanguage(code: string): boolean {
	const normalized = code.toLowerCase().trim();
	return SUPPORTED_DUBBING_LANGUAGES.some(
		(l) => l.code === normalized || l.floresCode.toLowerCase() === normalized,
	);
}

export function resolveDeepLLanguageCode(languageCode: string): string {
	const normalized = languageCode.trim().toLowerCase();
	if (normalized === "en" || normalized === "en-us") return "EN-US";
	if (normalized === "en-gb") return "EN-GB";
	if (normalized === "pt-br") return "PT-BR";
	if (normalized === "pt" || normalized === "pt-pt") return "PT-PT";
	if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans") return "ZH-HANS";
	if (normalized === "zh-tw" || normalized === "zh-hant") return "ZH-HANT";
	return normalized.slice(0, 2).toUpperCase();
}
