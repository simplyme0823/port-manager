import { build } from "esbuild";
import fs from "node:fs";

fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/port-manager.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  banner: {
    js: "#!/usr/bin/env node",
  },
});

fs.chmodSync("dist/port-manager.js", 0o755);
