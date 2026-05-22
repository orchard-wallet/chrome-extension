// Verifies every locale catalog has exactly the same key set as the `en` source.
// Usage: node scripts/check-i18n-parity.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = join(root, "src/i18n/locales");
const LOCALES = ["en", "zh-cn", "zh-tw", "ja-jp"];
const NAMESPACES = ["common", "popup", "settings"];

function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === "object" && !Array.isArray(value)
      ? flatten(value, path)
      : [path];
  });
}

function loadKeys(locale, ns) {
  const raw = readFileSync(join(localesDir, locale, `${ns}.json`), "utf8");
  return new Set(flatten(JSON.parse(raw)));
}

let failed = false;

for (const ns of NAMESPACES) {
  const enKeys = loadKeys("en", ns);
  for (const locale of LOCALES) {
    if (locale === "en") continue;
    const keys = loadKeys(locale, ns);
    const missing = [...enKeys].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !enKeys.has(key));
    if (missing.length || extra.length) {
      failed = true;
      console.error(`✗ ${locale}/${ns}.json`);
      if (missing.length) console.error(`  missing (${missing.length}): ${missing.join(", ")}`);
      if (extra.length) console.error(`  extra (${extra.length}): ${extra.join(", ")}`);
    }
  }
}

if (failed) {
  process.exit(1);
}

const total = NAMESPACES.reduce((sum, ns) => sum + loadKeys("en", ns).size, 0);
console.log(`✓ all locales match en (${total} keys × ${LOCALES.length - 1} locales)`);
