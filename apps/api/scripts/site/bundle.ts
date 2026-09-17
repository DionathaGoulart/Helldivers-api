import { build } from "esbuild";
import type { BuildInfo } from "../../src/build-info.ts";

// `dist/_worker.js` (Pages advanced mode, arch §8.1): one ESM bundle for workerd with the dataset's
// BuildInfo inlined, so a deploy of new data always ships Functions that know its version.

export async function bundleWorker(
  entry: string,
  outfile: string,
  info: BuildInfo,
): Promise<number> {
  const result = await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2024",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["module", "main"],
    minify: true,
    legalComments: "none",
    define: { __BUILD_INFO__: JSON.stringify(info) },
    metafile: true,
    logLevel: "warning",
  });
  return Object.values(result.metafile.outputs).reduce((bytes, output) => bytes + output.bytes, 0);
}
