export type AppLanguage = "en" | "zh-cn" | "zh-tw" | "ja-jp";

export const DEFAULT_LANGUAGE: AppLanguage = "en";

export const I18N_NAMESPACES = ["common", "popup", "settings"] as const;
export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

export interface LanguageOption {
  code: AppLanguage;
  label: string;
  englishLabel: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "en", label: "English", englishLabel: "English" },
  { code: "zh-cn", label: "简体中文", englishLabel: "Simplified Chinese" },
  { code: "zh-tw", label: "繁體中文", englishLabel: "Traditional Chinese" },
  { code: "ja-jp", label: "日本語", englishLabel: "Japanese" }
];

export function isAppLanguage(value: unknown): value is AppLanguage {
  return SUPPORTED_LANGUAGES.some((entry) => entry.code === value);
}

export function resolveBrowserLanguage(): AppLanguage {
  const nav = typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "";
  if (nav.startsWith("zh")) {
    return /tw|hk|mo|hant/.test(nav) ? "zh-tw" : "zh-cn";
  }
  if (nav.startsWith("ja")) {
    return "ja-jp";
  }
  return "en";
}
