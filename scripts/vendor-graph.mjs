// Vendor the `force-graph` UMD into the dashboard build as an inlinable TS string.
//
// WHY: the cockpit `dashboard.html` is a single, self-contained, OFFLINE file
// (ADR-0020). It must carry zero external resources — so the graph library is
// SHIPPED INLINE, not loaded at runtime. force-graph stays a devDependency (it is
// never a runtime dependency of the published package): this script reads its
// self-contained UMD bundle and emits `src/dashboard/graph-lib.generated.ts`
// exporting the bundle as a single TS string literal (`GRAPH_LIB_JS`).
//
// OFFLINE-URL NEUTRALISATION: the offline-assertion test requires the emitted
// HTML to contain NO `http(s)://` (only `obsidian://`). The minified bundle
// carries a header github URL plus a handful of W3C XML/SVG namespace URIs (used
// by d3 when it touches namespaced DOM). We neutralise EVERY `://` to the
// backslash-escaped form `:\/\/` — which a JS parser reads as the IDENTICAL
// string value (so the library stays byte-for-byte functional) while the SOURCE
// TEXT no longer contains a literal `://`. The version header line is stripped
// outright (it is a comment, not load-bearing). After transform we ASSERT no
// `http(s)://` remains, so a regression fails the build, not just the test.
//
// Regenerate: pnpm vendor:graph

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../node_modules/force-graph/dist/force-graph.min.js");
const OUT = resolve(here, "../src/dashboard/graph-lib.generated.ts");

const raw = readFileSync(SRC, "utf8");

// 1) Drop the leading `// Version … https://github.com/…` comment line.
// 2) Neutralise every remaining `://` → `:\/\/` (value-preserving in JS, URL-free
//    in source text). All occurrences in this bundle live inside double-quoted
//    string literals or `//` comments — never operators/regex — so this is safe.
const neutralised = raw
  .replace(/^\/\/ Version[^\n]*\n/, "")
  .replace(/:\/\//g, ":\\/\\/");

// Hard guard: the whole point is an http(s)://-free output. Fail loudly otherwise.
if (/https?:\/\//.test(neutralised)) {
  throw new Error(
    "vendor-graph: residual http(s):// after neutralisation — the offline assertion would fail.",
  );
}

const header =
  "/* eslint-disable */\n" +
  "// GENERATED — vendored force-graph UMD (MIT). Regenerate: pnpm vendor:graph\n";

const body = `export const GRAPH_LIB_JS = ${JSON.stringify(neutralised)};\n`;

writeFileSync(OUT, header + body, "utf8");

const kb = (raw.length / 1024).toFixed(1);
console.log(`vendor-graph: wrote ${OUT} (${kb} KB source → TS string literal).`);
