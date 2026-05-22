/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_ZERO_EX_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const chrome: {
  action?: {
    openPopup?(): Promise<void> | void;
  };
  runtime?: {
    getURL?(path: string): string;
    lastError?: {
      message?: string;
    };
    openOptionsPage?(): void;
    onInstalled?: {
      addListener(listener: () => void): void;
    };
    onStartup?: {
      addListener(listener: () => void): void;
    };
    onMessage?: {
      addListener(
        listener: (
          message: unknown,
          sender: { tab?: { id?: number }; origin?: string; url?: string },
          sendResponse: (response?: unknown) => void
        ) => boolean | void
      ): void;
    };
    sendMessage?(message: unknown, responseCallback?: (response: unknown) => void): void;
  };
  alarms?: {
    create(name: string, alarmInfo: { delayInMinutes?: number; periodInMinutes?: number }): void;
    onAlarm?: {
      addListener(listener: (alarm: { name: string }) => void): void;
    };
  };
  storage?: {
    local?: {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
    onChanged?: {
      addListener(listener: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, areaName: string) => void): void;
      removeListener(listener: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, areaName: string) => void): void;
    };
  };
};
