import type { DubbingModelQuantization } from "../types";

export interface DubbingLanguageOption {
	code: string;
	floresCode: string;
	name: string;
	nativeName: string;
}

export const SUPPORTED_DUBBING_LANGUAGES: DubbingLanguageOption[] = [
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

export interface QuantizationOptionConfig {
	id: DubbingModelQuantization;
	name: string;
	badge: string;
	size: string;
	description: string;
}

export const QUANTIZATION_OPTIONS: QuantizationOptionConfig[] = [
	{
		id: "int8",
		name: "INT8 Quantized",
		badge: "Fast & Compact",
		size: "~300 MB",
		description:
			"Fastest download and synthesis, minimal RAM usage. Recommended for most machines.",
	},
	{
		id: "fp16",
		name: "FP16 Half Precision",
		badge: "Balanced",
		size: "~600 MB",
		description: "Balanced speed and translation phrasing nuances.",
	},
	{
		id: "fp32",
		name: "FP32 Full Precision",
		badge: "High Fidelity",
		size: "~1.2 GB",
		description: "Unquantized model precision. Requires more disk and memory.",
	},
];

export type TtsQuantization = "q4_k_m" | "q8_0" | "fp16";

export interface TtsQuantizationOptionConfig {
	id: TtsQuantization;
	name: string;
	badge: string;
	size: string;
	description: string;
	recommendedRam: string;
}

export const TTS_QUANTIZATION_OPTIONS: TtsQuantizationOptionConfig[] = [
	{
		id: "q4_k_m",
		name: "INT4 (Q4_K_M)",
		badge: "Fast & Compact",
		size: "~1.2 GB",
		description: "Lightweight 4-bit quantization. Fast inference on CPU/integrated GPU.",
		recommendedRam: "8GB+ RAM",
	},
	{
		id: "q8_0",
		name: "INT8 (Q8_0)",
		badge: "Balanced (Recommended)",
		size: "~2.1 GB",
		description: "Near full-precision voice timbre preservation with 8-bit quantized weights.",
		recommendedRam: "16GB+ RAM",
	},
	{
		id: "fp16",
		name: "FP16 Full Precision",
		badge: "Studio Master",
		size: "~4.2 GB",
		description: "Uncompromised acoustic studio fidelity for dedicated GPU setups.",
		recommendedRam: "24GB+ RAM / GPU",
	},
];
