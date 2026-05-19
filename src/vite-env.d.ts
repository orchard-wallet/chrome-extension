/// <reference types="vite/client" />

declare const chrome: {
  runtime?: {
    onInstalled?: {
      addListener(listener: () => void): void;
    };
  };
  storage?: {
    local?: {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
  };
};
