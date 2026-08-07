// apps/backend/esbuild.config.js
//
// Bundles the backend into a single self-contained dist/index.js.
//
// Why bundle instead of the plain `tsc` output the desktop app used to
// depend on: apps/desktop packages apps/backend/dist as an electron-builder
// extraResource, OUTSIDE app.asar (see apps/desktop/package.json). Node's
// module resolution walks up the real directory tree from the script being
// run looking for node_modules, and resources/backend/dist has no
// node_modules anywhere in its ancestor chain in the packaged app (the
// packaged app's own node_modules live inside app.asar, a sibling — not an
// ancestor — of resources/backend). A plain `tsc` build that still calls
// require("fastify") etc. therefore fails at runtime in the packaged app
// with MODULE_NOT_FOUND, even though it works fine in dev. Bundling inlines
// all first-party/npm dependencies (fastify, @fastify/websocket,
// @anthropic-ai/claude-agent-sdk, @agentos/shared) into dist/index.js so no
// runtime module resolution outside the file itself is needed. Only true
// Node.js builtins (fs, path, node:sqlite, ...) stay external — esbuild does
// this automatically for platform: "node".
const esbuild = require("esbuild");

// Output as ESM (.mjs), not CJS: some dependencies (e.g. the Claude Agent
// SDK) use `createRequire(import.meta.url)` internally to locate bundled
// assets relative to their own module. esbuild's CJS output shims
// import.meta to an empty object, making import.meta.url undefined and
// crashing that code at runtime. ESM output preserves real import.meta.url
// semantics, so it works with those dependencies unmodified.
esbuild
  .build({
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.mjs",
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    sourcemap: true,
    logLevel: "info",
    // Some bundled CJS dependencies (fastify's `avvio`, etc.) call a
    // dynamic require(variable) at runtime for conditional/optional
    // requires. esbuild's ESM output otherwise has no working `require` at
    // all. This banner restores a real one via Node's own createRequire,
    // scoped to this bundle's own URL — the standard esbuild recipe for
    // bundling CJS-oriented packages to ESM output.
    banner: {
      js: "import { createRequire as __agentosCreateRequire } from 'node:module';\nimport { fileURLToPath as __agentosFileURLToPath } from 'node:url';\nimport __agentosPath from 'node:path';\nconst require = __agentosCreateRequire(import.meta.url);\nconst __filename = __agentosFileURLToPath(import.meta.url);\nconst __dirname = __agentosPath.dirname(__filename);",
    },
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
