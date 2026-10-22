# AGENTS.md: working on forms

This file is for anyone who changes this repository, people and coding agents alike. It says how the repository is laid out, how to implement
and test a change, and how a pull request is reviewed. To **use** the released package, read [README.md](README.md) and [SKILL.md](SKILL.md)
instead; to take part in the project, read [CONTRIBUTING.md](CONTRIBUTING.md).

Schema-validated forms: typed paths, field arrays, async validation and server errors.

## What is in this repository

| Package | Folder | What it is | Documentation |
| --- | --- | --- | --- |
| `@shadow-js/forms` | `.` | Forms with fine-grained values, schema validation, field arrays and server errors | https://forms.shadowjs.net |

The repository is the package: `@shadow-js/forms`. Source and issues:
https://github.com/shadowjs-dev/forms. Every package of the project has the same version number.

## Set up

You need Node.js 22.12 or newer and npm (pnpm and Yarn are not used).

```sh
npm install
npm run check   # lint, build, type check and every test
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run lint` | Biome: lint and format check (`npx biome check --write <path>` fixes what it can) |
| `npm run build` | builds the package with tsdown |
| `npm run typecheck` | TypeScript 7 in strict mode, tests included |
| `npm test` | unit, DOM and server tests (Vitest) |
| `npx vitest run <path>` | one test file |
| `npm run test:gc` | memory and leak tests |
| `npm run test:perf` | wall-clock budgets; run alone, never in parallel with other work |
| `npm run check` | all of the above; a change is ready when it passes |

## Layout

- `.github/`: workflows, issue and pull request templates, code owners.
- `build/`: the shared tsdown preset every package build uses.
- `scripts/`: build and release scripts; `release.mjs` is run by the workflows.
- `src/`: the source of the package; one folder per concern, `index.ts` re-exports the public API. Folders: `internal/`.
- `test/`: the tests; one file per behavior, each test named by an invariant id such as `[ROUTER-12]`.
- `test-types/`: type-level tests: what the package promises to the compiler of its users.
- `types/`: ambient declarations shared with the build.
- `CHANGELOG.md`: what each release changed.
- `biome.json`: lint and format rules.
- `package.json`: the manifest; `version` is changed only by a release.
- `tsconfig.json`: type check of the source.
- `tsdown.config.mjs`: the build.
- `vitest.config.ts`: the test projects (unit, DOM, server, gc, perf).
- `vitest.setup.ts`: test setup: an unasserted `console.warn` or `console.error` fails a test.

## How to implement a change

1. **Find where the behavior lives.** Search `test/` and `src/` for the name of the behavior or its invariant id, then read the source the tests exercise. The invariants below say what must stay true.
2. **Write the failing test first.** A bug fix reproduces the bug; a feature states the behavior it promises. Name the test with an invariant id in square brackets, the way the neighboring tests do, then the behavior in words. The test asserts what the code does and is never skipped, marked as todo or marked as an expected failure.
3. **Make it pass with the smallest change** that keeps the invariants. Match the code around it.
4. **Keep the surface honest.** A public symbol has TSDoc (summary, parameters, return value, an example and `@since`). An error says what happened and how to fix it. User-visible behavior gets a documentation update and a line under `## Unreleased` in CHANGELOG.md.
5. **Run `npm run check`** and read its output; do not report a change as done without it passing.

### Rules every change keeps

- No `any`, `@ts-ignore` or non-null assertion. Use `unknown` and narrow.
- Compare indices, lengths and counts explicitly (`=== undefined`, `=== -1`, `> 0`), never by truthiness.
- No empty `catch`: every catch rethrows, passes the error to the owner's handler, or reports it. Every "set the current X" register is restored in `finally`.
- User callbacks run untracked unless the API says otherwise. No stack parsing, no `fn.name` sniffing, no flags stamped on user functions.
- Traversals whose depth the user controls are iterative. Caches, queues and recursion are bounded, and a test hits the bound.
- Code meant for development only sits behind `__DEV__`. No import-time side effects and no module-level mutable state beyond the registers the core owns (bounded caches and `WeakMap`s excepted).
- No sleeps in tests (flush the scheduler); a `console.warn` or `console.error` that a test does not assert fails the test. Property tests use `fast-check` with a fixed seed.
- Files are kebab-case, tests are `*.test.ts`, internals live in `src/internal/`. American English in code, comments and documentation. Comments explain why, not what.
- The reactive core and the DOM renderer have no runtime dependencies.

## Pull requests

1. **Open an issue first** for anything that adds or changes public API, behavior, supported platforms or dependencies. A small fix needs no issue.
2. **Fork, then branch from `main`** (`fix/<topic>`, `feat/<topic>`, `docs/<topic>`). One concern per pull request.
3. **Commit in small steps** with a message that says what changed and why: a short type prefix (`fix:`, `feat:`, `docs:`, `test:`, `chore:`), then the subject. Commit under your own identity; do not add trailers or notes about tools.
4. **Open the pull request against `main`** and fill in the template: what changes, why, and the checks you ran. The CI workflow (`.github/workflows/ci.yml`) runs lint, build, type check and all tests; it must be green.
5. **Review.** A maintainer (see `.github/CODEOWNERS`) reviews every pull request. Expect questions about the test, the public surface and the error messages. Push fixes to the same branch; the pull request is squash-merged.
6. **Releases are not part of a pull request.** Do not change `version`, `.github/workflows/release.yml` or `scripts/release.mjs`, and do not create tags or publish. A maintainer releases by renaming `## Unreleased` in the changelog to the version and pushing a version that is not yet on npm to `main`; the workflow publishes it with provenance.

Security problems never go in a public issue or pull request: follow [SECURITY.md](SECURITY.md).

## Architecture and invariants

What each package keeps true. A change that breaks one of these is a bug in the change.

Package-specific rules:

### Layout
```
src/index.ts          public barrel for @shadow-js/forms
src/server.ts         @shadow-js/forms/server: pure helpers, NO reactive imports (FormData, issues)
src/use-form.ts       useForm: builds the Core, the public FormApi and the handle caches (the minimal path)
src/arrays.ts         feature `fieldArrays` (@shadow-js/forms/arrays): form.fields, row lists, array helpers
src/async.ts          feature `asyncValidation` (@shadow-js/forms/async): promises, debounce, cancellation
src/submit-errors.ts  feature `submitErrors` (@shadow-js/forms/submit-errors): thrown issues, initialErrors
src/dates.ts          feature `dates` (@shadow-js/forms/dates): date, time, month, week, datetime-local controls
src/internal/dates.ts the date codecs (parse, format, codec); reached only through the `dates` plug
src/standard-schema.ts `standardSchema(schema)`, the resolver of a Standard Schema (@shadow-js/forms/standard-schema)
src/full.ts           full preset (@shadow-js/forms/full): re-exports useForm, `full` = the four features in order
src/types.ts          every public type (FormApi, FieldApi, FieldArrayApi, RowApi, options, Path<T>)
src/path.ts           path grammar + getIn/setIn/deleteIn/patterns (iterative, reserved keys refused)
src/data.ts           plainClone / deepEqual / leafPaths (iterative, cycle safe)
src/components.ts     <Form> <Field> <FieldArray>, useFormContext (no JSX: Form renders via Dynamic)
src/wizard.ts guard.ts bind.ts server-errors.ts server-issues.ts form-data.ts
src/internal/         shape.ts (isRecord: shape checks, imports nothing), state.ts (Core, Rec, RowList, stable keys), validate.ts (engine), mutate.ts
                      (writes, reset), field.ts (field handle + prop bags), array.ts (field array,
                      row handles, array operations), rows.ts (row lists, the arrays plug), async.ts
                      (the async plug), feature-host.ts, fields-of.ts, cache.ts, promise.ts, loc.ts,
                      controls.ts (codecs), submit.ts, issues.ts
test/                 *.test.ts (node), *.dom.test.ts (happy-dom), *.server.test.ts (server build)
test/fixtures/        .tsx compiled with the real compiler by test/support/compile.ts (dom + ssr)
test-types/           type tests: inference + @ts-expect-error (README examples included)
```

### Rules
- Imports: `@shadow-js/core`, `@shadow-js/core/extend` (cells only), `@shadow-js/web`,
  `@shadow-js/web/jsx-runtime` (types). Never the router, dusk, primitives or a UI package. Tests
  may use the testing helpers of `@shadow-js/testing`.
- The sources are plain TypeScript, not TSX: `<Form>` renders through `Dynamic`, so no compiler plugin
  and no server build are needed. Fixtures (`test/fixtures/*.tsx`) are compiled for tests only.
- `src/server.ts` and everything it imports (`form-data`, `server-issues`, `internal/issues`,
  `internal/empty`, `path`, `data`, `standard-schema`) must not import `@shadow-js/core` or touch
  `document`/`window`. Check `dist/prod/server.js` stays small after changing them.
- Nothing may touch `document`, `window`, `HTMLElement`... at import time or while creating a form:
  `useForm` runs on the server and in node tests (`test/arrays.test.ts` runs it without a DOM).
  Guard with `typeof document === "undefined"` or only touch them inside event handlers/`ref`.
- Reactivity: a field's state lives in `Rec`s keyed by a **stable key** (path with every array index
  replaced by the id of the row there). Never key per-field state by an index path. Row removal must
  go through `removeRowState` so records, row lists and nested lists disappear with the row
  (`test/arrays.dom.test.ts` [FRM-114], `sizesOf`).
- Per-field cells (`Slot`) are created on the first tracked read. A write to a slot with no reader
  allocates nothing. A keystroke must notify only the readers of the field that changed
  (`test/perf.dom.test.ts`); do not add a signal that every field reads.
- Validation has two layers: *truth* (`rec.truth`, always current, drives `isValid`) and *shown*
  (`slots.shown`, changed only by `reveal()` according to `validateOn` / `reValidateOn`). Keep
  them apart; the rules live in `shouldShow` in `internal/validate.ts`.
- `isValid()` is `false` until the first asynchronous schema answer (`core.unknown`) and while a schema requires a
  field that is disabled and excluded (`core.excluded`); a submit marks every field touched. [FRM-280, FRM-285, FRM-288]
- Forms created without an owner are numbered (`form`, `form-2`...) by a module-level counter in `use-form.ts`: the
  one module-level register of the package, there is no owner tree to derive an id from. [FRM-287]
- Every asynchronous result is applied only if its run is still the current one (`rec.run`,
  `core.schemaRun.token`, `core.submitToken`) and the form is not disposed.
- User callbacks (validators, `onSubmit`) never run inside a tracking scope; a throw becomes an issue,
  never an uncaught error, and nothing logs to the console.
- Caches and registers are bounded and tested: prop bags (`MAX_PROP_BAGS`), handles (`MAX_HANDLES`),
  registered controls (pruned when disconnected), records of removed rows.
- Public symbols have TSDoc with `@example` (functions) and `@since 1.0.0`. Optional properties are
  `readonly x?: T | undefined` (the repo uses `exactOptionalPropertyTypes`).
- The field handle shape (`value`, `error`, `touched`, `onInput`, `onBlur`, `setValue`, `props`...) is
  consumed by UI kits. Add members; do not rename or change the meaning of existing ones.

- Reset (`resetAll` in `internal/mutate.ts`) takes `ResetOptions`: `keepValues` keeps the rows and
  the values (defaults still follow the argument), `keepDefaultValues`/`keepDirty` keep the baseline,
  and `clearRec(core, rec, keep)` keeps errors or touched flags. `unregisterPath` forgets a field.
- Dirty: a value is dirty only if it differs from its own default (rows compare with their origin) AND the form is dirty (`isDirtyAgainstDefault` in state.ts). A list equal to its defaults as a whole is clean, so no row or field of it is dirty. [FRM-978, FRM-979]
- Native reset: a file input's form gets one `reset` listener (attached in a microtask after bind, since the ref runs before the `type` attribute is applied); it writes `undefined` to the field. Only file controls listen. [FRM-980, FRM-981]
- `shouldUnregister` is checked before every write (`dropDetached`): a control that was on the page
  (`binding.attached`) and has left drops its field's value. A control that never attached is kept.
- `criteriaMode` (default `"all"`) only trims `errors()` and `issues()`; `error()` is always the first.
- Asynchronous `defaultValues` and the `values` accessor are applied in `use-form.ts`; a failed load is
  kept for `loadError()` (it never throws). `formState` and `getFieldState` return getters over the
  field and form accessors, so a read subscribes to that part only (`FRM-416`, `FRM-417`).
- The React Hook Form names live in `src/hooks.ts` (`useWatch`, `useFormState`, `useFieldArray`) and
  `src/components.ts` (`FormProvider`, `Controller`). They add no state of their own.

### Features and the minimal path

- The minimal path (`use-form.ts`, `components.ts`, and what they import) imports none of `arrays.ts`,
  `async.ts`, `submit-errors.ts`, `standard-schema.ts`, `internal/array.ts`, `internal/rows.ts`,
  `internal/async.ts`, `hooks.ts`, `wizard.ts`, `guard.ts`, `bind.ts`, `form-data.ts`, `server-errors.ts`,
  `server-issues.ts`. `test/split.test.ts` [FRM-500] walks the runtime imports and fails on any of them.
- A feature is an object (`FormFeature`) that `useForm` installs once: it sets a plug on the core
  (`core.arrays`, `core.async`, `core.submitErrors`) and may add its member to the form (`fields`). The
  engine calls a plug only as `core.x?.(...)`; a form without the feature has none of them.
- Without a feature the engine refuses, it never silently passes: a promise is an issue that names
  `asyncValidation`; `debounceMs` and `initialErrors` throw when the form is created; `form.fields` is
  absent (the hook throws). `schema` throws a TypeError that names `resolver: standardSchema(schema)`.
- `form.fields` is typed only when the feature list has `"arrays"` (`FeatureApi`). Explicit type arguments
  to `useForm` fall back to the loose overload with features: pass the features, or leave the types inferred.
- Row ids and stable keys exist only in a form with `arrays`; without it an index is a plain key.

### Tests
- Invariant ids `[FRM-nn]`, unique across the suite (the React Hook Form names use `[FRM-400]`..`[FRM-423]`). Test first. No `.skip`/`.only`/`.todo`, no
  sleeps: `flushSync()`, `await settle()` (promise turns only) or fake timers for debounce.
- Un-asserted `console.warn`/`console.error` fails a test (`vitest.setup.ts`).
- Property tests use `fast-check` with `{ seed: 42 }`: paths and the array operations against a plain
  array model (`test/path.test.ts`, `test/arrays.test.ts`).
- happy-dom caches `HTMLSelectElement.selectedOptions`; read `option.selected` instead.
- `*.server.test.ts` run with `__SERVER__ = true` (use them for anything that renders markup with
  `Dynamic`); `*.dom.test.ts` render with the browser runtime.

## Where to look next

- [README.md](README.md): what the package does and every option.
- [SKILL.md](SKILL.md): how to use the released package (install, import paths, a quick start).
- [CONTRIBUTING.md](CONTRIBUTING.md): the short guide to taking part.
- [CHANGELOG.md](CHANGELOG.md): what each release changed.
- [ShadowJS hub](https://github.com/shadowjs-dev/shadow): every repository of the project.
