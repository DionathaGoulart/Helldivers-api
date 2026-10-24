import { createHash } from "node:crypto";
import { type BuildOptions, build } from "esbuild";
import type { BuildInfo } from "../../src/build-info.ts";

// `build/worker.js` (the Worker's `main`, arch §8.1): one ESM bundle for workerd with the dataset's
// BuildInfo inlined, so a deploy of new data always ships a Worker that knows its version. It lives
// outside `dist/`, which is uploaded as public static assets.

export async function bundleWorker(
  entry: string,
  outfile: string,
  info: BuildInfo,
): Promise<number> {
  const options: BuildOptions = {
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
    define: { __BUILD_INFO__: JSON.stringify({ ...info, responseVersion: undefined }) },
    metafile: true,
    logLevel: "warning",
  };
  // Hash the complete compiled program, including dependencies and dataset metadata. Do not
  // depend on CI's event SHA: workflow_run can build a different checkout, as can local builds.
  const preview = await build({ ...options, write: false });
  const hash = createHash("sha256");
  for (const file of preview.outputFiles ?? []) hash.update(file.contents);
  const responseVersion = hash.digest("hex");
  const result = await build({
    ...options,
    define: { __BUILD_INFO__: JSON.stringify({ ...info, responseVersion }) },
  });
  return Object.values(result.metafile?.outputs ?? {}).reduce(
    (bytes, output) => bytes + output.bytes,
    0,
  );
}
