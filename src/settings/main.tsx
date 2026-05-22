import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SettingsApp } from "./SettingsApp";
import { bootstrapI18n } from "../i18n";
import "../styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element was not found.");
}

void bootstrapI18n().then(() => {
  createRoot(root).render(
    <StrictMode>
      <SettingsApp />
    </StrictMode>
  );
});
