import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const root = rootIdx >= 0 ? resolve(args[rootIdx + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(readFileSync(join(root, "schema", "source.json"), "utf8"));

const fields = Object.keys(source.Item);
const out =
  "// GENERATED from schema/source.json by scripts/gen.js; do not edit\n" +
  `export const ITEM_FIELDS = ${JSON.stringify(fields)};\n`;

if (args.includes("--stdout")) process.stdout.write(out);
else writeFileSync(join(root, "generated", "schema.js"), out);
