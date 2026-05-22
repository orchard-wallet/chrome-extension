import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import {
  DEFAULT_LANGUAGE,
  I18N_NAMESPACES,
  isAppLanguage,
  resolveBrowserLanguage,
  type AppLanguage
} from "./config";
import { readWalletUiSettings, writeWalletUiSettings } from "../lib/storage";

import enCommon from "./locales/en/common.json";
import enPopup from "./locales/en/popup.json";
import enSettings from "./locales/en/settings.json";
import zhCnCommon from "./locales/zh-cn/common.json";
import zhCnPopup from "./locales/zh-cn/popup.json";
import zhCnSettings from "./locales/zh-cn/settings.json";
import zhTwCommon from "./locales/zh-tw/common.json";
import zhTwPopup from "./locales/zh-tw/popup.json";
import zhTwSettings from "./locales/zh-tw/settings.json";
import jaJpCommon from "./locales/ja-jp/common.json";
import jaJpPopup from "./locales/ja-jp/popup.json";
import jaJpSettings from "./locales/ja-jp/settings.json";

const resources = {
  en: { common: enCommon, popup: enPopup, settings: enSettings },
  "zh-cn": { common: zhCnCommon, popup: zhCnPopup, settings: zhCnSettings },
  "zh-tw": { common: zhTwCommon, popup: zhTwPopup, settings: zhTwSettings },
  "ja-jp": { common: jaJpCommon, popup: jaJpPopup, settings: jaJpSettings }
} as const;

let initialized = false;

export function initI18n(language: AppLanguage = DEFAULT_LANGUAGE): typeof i18next {
  if (!initialized) {
    void i18next.use(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: DEFAULT_LANGUAGE,
      // Resource keys are lowercase (en, zh-cn, zh-tw, ja-jp); without this
      // i18next region-uppercases codes (zh-tw -> zh-TW) and misses them.
      lowerCaseLng: true,
      supportedLngs: ["en", "zh-cn", "zh-tw", "ja-jp"],
      nonExplicitSupportedLngs: false,
      ns: [...I18N_NAMESPACES],
      defaultNS: "common",
      interpolation: { escapeValue: false },
      returnNull: false
    });
    initialized = true;
  } else if (i18next.language !== language) {
    void i18next.changeLanguage(language);
  }
  return i18next;
}

export async function bootstrapI18n(): Promise<typeof i18next> {
  let language: AppLanguage = DEFAULT_LANGUAGE;
  try {
    const settings = await readWalletUiSettings();
    language = isAppLanguage(settings.language) ? settings.language : resolveBrowserLanguage();
  } catch {
    language = resolveBrowserLanguage();
  }
  return initI18n(language);
}

export async function changeAppLanguage(language: AppLanguage): Promise<void> {
  await i18next.changeLanguage(language);
  try {
    const settings = await readWalletUiSettings();
    await writeWalletUiSettings({ ...settings, language });
  } catch {
    /* settings persistence is best-effort */
  }
}

export default i18next;
