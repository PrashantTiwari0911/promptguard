// Bundles each extension script with esbuild and copies static files into dist/.
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });

const options = {
  entryPoints: {
    content: "src/content/index.ts",
    backstop: "src/backstop/main-world.ts",
  },
  bundle: true,
  format: "iife",
  target: "chrome120",
  outdir: "dist",
  legalComments: "none",
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
