// Copies the child app into ./www and points it at your Railway server.
// Usage: LS_API=https://your-app.up.railway.app npm run sync
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "public", "app");
const out = path.join(here, "www");
const api = (process.env.LS_API || "").replace(/\/$/, "");
if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(api)) {
  console.error("Set LS_API to your server's https address, e.g.\n  LS_API=https://little-screen.up.railway.app npm run sync");
  process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
fs.copyFileSync(path.join(here, "..", "public", "base.css"), path.join(out, "base.css"));
fs.writeFileSync(path.join(out, "config.js"), `window.LS_API = ${JSON.stringify(api)};\n`);
console.log(`Built www/ for ${api}`);
