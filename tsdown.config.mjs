import { createConfig } from "./build/tsdown-preset.mjs";

// The sources are plain TypeScript (the components render through `Dynamic`, which resolves to the
// right runtime for the browser and the server), so no compiler plugin is needed. There are no
// `__SERVER__` differences either, so dev and prod builds are enough.
export default createConfig({
  entries: {
    index: "src/index.ts",
    server: "src/server.ts",
    arrays: "src/arrays.ts",
    async: "src/async.ts",
    "submit-errors": "src/submit-errors.ts",
    "standard-schema": "src/standard-schema.ts",
    dates: "src/dates.ts",
    full: "src/full.ts",
  },
  packageDir: import.meta.dirname,
});
