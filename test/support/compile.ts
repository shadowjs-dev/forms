/**
 * Compiles the JSX fixtures in `test/fixtures` with the real ShadowJS compiler, the way an
 * application bundle would, for the `dom` and `ssr` targets. The library itself is plain
 * TypeScript, so fixtures import the very same source modules the tests do (one module instance),
 * by absolute path.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@shadow-js/compiler/javascript";

export type Target = "dom" | "ssr";

const here: string = dirname(fileURLToPath(import.meta.url));
/** `packages/forms` */
export const packageRoot: string = join(here, "..", "..");
const srcRoot: string = join(packageRoot, "src");
const out: string = join(packageRoot, "test", ".generated");

function writeIfChanged(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  try {
    if (readFileSync(file, "utf8") === content) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, file);
}

/** Compiles `test/fixtures/<name>.tsx` for `target` and imports it. */
export async function loadFixture<T = Record<string, unknown>>(
  target: Target,
  name: string,
): Promise<T> {
  const file = join(packageRoot, "test", "fixtures", `${name}.tsx`);
  const result = compile(readFileSync(file, "utf8"), {
    filename: file,
    generate: target,
    dev: true,
    hmr: false,
    sourceMap: false,
  });
  const code = result.code.replaceAll('"../../src/', `"${srcRoot}/`);
  const target_ = join(out, target, `${name}.ts`);
  writeIfChanged(target_, code);
  return (await import(/* @vite-ignore */ target_)) as T;
}
