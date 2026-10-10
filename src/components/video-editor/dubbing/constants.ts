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

export type TtsQuantization = "q4_k_m" | "q5_k_m" | "q6_k" | "q8_0" | "f16" | "fp16";

export interface TtsQuantizationOptionConfig {
	id: TtsQuantization;
	name: string;
	badge: string;
	size: string;
	sizeBytes: number;
	description: string;
	recommendedRam: string;
}

export const TTS_QUANTIZATION_OPTIONS: TtsQuantizationOptionConfig[] = [
	{
		id: "q4_k_m",
		name: "INT4 (Q4_K_M)",
		badge: "Fastest",
		size: "3.6 GB",
		sizeBytes: 3_566_165_088,
		description: "Lightweight 4-bit quantization. Fast inference on CPU and standard hardware with lowest VRAM usage.",
		recommendedRam: "8 GB+ RAM / CPU",
	},
	{
		id: "q5_k_m",
		name: "Q5_K_M",
		badge: "Balanced (Recommended)",
		size: "4.0 GB",
		sizeBytes: 4_031_183_968,
		description: "5-bit medium quantization. Optimal balance between speech expressiveness, timbre accuracy, and latency.",
		recommendedRam: "12 GB+ RAM / 4 GB VRAM",
	},
	{
		id: "q6_k",
		name: "Q6_K",
		badge: "High Quality",
		size: "4.5 GB",
		sizeBytes: 4_525_266_528,
		description: "6-bit quantization. Superior voice inflection fidelity and tone nuance for modern GPUs.",
		recommendedRam: "14 GB+ RAM / 6 GB VRAM",
	},
	{
		id: "q8_0",
		name: "INT8 (Q8_0)",
		badge: "Near-Lossless",
		size: "5.6 GB",
		sizeBytes: 5_630_037_088,
		description: "Near full-precision 8-bit weights. Preserves fine vocal nuances, emotional inflection, and studio polish.",
		recommendedRam: "16 GB+ RAM / 8 GB VRAM",
	},
	{
		id: "f16",
		name: "FP16 (Full Model)",
		badge: "Reference Master",
		size: "9.9 GB",
		sizeBytes: 9_906_568_704,
		description: "Uncompromised 16-bit unquantized studio master weights. Maximum acoustic fidelity for high-end GPUs.",
		recommendedRam: "24 GB+ RAM / 12 GB+ VRAM",
	},
];

