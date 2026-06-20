#!/usr/bin/env node
// Regenerate the docs site's code-derived data (thresholds + hooks) from the
// built package. Run via `pnpm docs:gen` (which builds first). The drift test
// `src/docs/generated-data.test.ts` fails CI if the committed JSON is stale.
//
// Imports from dist (not src) so this stays a plain .mjs with no TS runner; the
// drift test imports from src directly (vitest handles TS), and both share the
// same pure builder, so the two outputs are byte-identical by construction.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildGeneratedDocsData, serializeGeneratedDocsData } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, "..", "docs", "src", "generated", "mage-data.json");

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, serializeGeneratedDocsData(buildGeneratedDocsData()));
console.log(`[gen-docs] wrote ${outFile}`);
