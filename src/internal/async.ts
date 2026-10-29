/**
 * The asynchronous part of validation: promised answers of the resolver, the form validator and
 * field validators, the debounce timers, cancellation of superseded runs, and the `isValidating`
 * counters. Only the `asyncValidation` feature installs it; without it the engine answers
 * synchronously and refuses a promise (see `validate.ts`).
 * @packageDocumentation
 */
import { batch } from "@shadow-js/core";
import { type Segment, startsWith } from "../path";
import type { FieldIssue } from "../types";
import { type Core, issuesEqual, NO_ISSUES, type Rec, recomputeTruth, slotsOf } from "./state";
import { applyGlobal, execute, type Pending, type Request, reveal } from "./validate";

/**
 * What the asynchronous feature adds to a form. The engine calls these only when they exist.
 * @internal
 */
export interface AsyncPlug {
  /** Starts a global pass; a live pass of an asynchronous check waits for the debounce first. */
  readonly runGlobal: (req: Request, changed: Set<string>) => Promise<void> | undefined;
  /** Applies a pass whose answers include promises, once they settle (only the latest pass counts). */
  readonly settleLater: (req: Request, answers: readonly Pending[], token: number) => Promise<void>;
  /** Records that the last global answer was synchronous. */
  readonly syncGlobal: () => void;
  /** Field validators that answered with promises: the field shows its validating state until they settle. */
  readonly field: (
    rec: Rec,
    req: Request,
    sync: FieldIssue[],
    later: readonly PromiseLike<FieldIssue[]>[],
    controller: AbortController,
    changed: Set<string>,
  ) => Promise<void>;
  /** Runs `evaluateNow` after `delay` ms without another change of the field. */
  readonly debounceField: (
    rec: Rec,
    req: Request,
    delay: number,
    evaluateNow: (later: Set<string>) => Promise<void> | undefined,
  ) => Promise<void>;
  /** Stops the asynchronous work of one field. */
  readonly cancel: (rec: Rec) => void;
  /** Stops the global debounce timer (a reset or the disposal of the form). */
  readonly stop: () => void;
}

/** The most paths a debounce window remembers before it stands for every path. */
const MAX_WINDOW_PATHS = 256;

/** The paths of a window plus those of one more change; `undefined` (every path) when either is, or past the bound. */
function widen(
  held: readonly (readonly Segment[])[] | undefined,
  more: readonly (readonly Segment[])[] | undefined,
): Segment[][] | undefined {
  if (held === undefined || more === undefined) return undefined;
  const out = held.map((path) => [...path]);
  for (const path of more) {
    if (!out.some((known) => known.length === path.length && startsWith(known, path))) {
      out.push([...path]);
    }
  }
  return out.length > MAX_WINDOW_PATHS ? undefined : out;
}

/** Sets the validating flag and keeps the counter in step. */
function setValidatingFlag(core: Core, rec: Rec, validating: boolean): void {
  if (rec.slots === undefined && !validating) return;
  if (slotsOf(rec).validating.set(validating)) {
    core.validatingCount.set(core.validatingCount.peek() + (validating ? 1 : -1));
  }
}

/** True when a change could make a problem visible, so a live asynchronous pass is worth running. */
function wantsLive(core: Core): boolean {
  const phase = core.submitCount.peek() > 0 ? core.opts.reValidateOn : core.opts.validateOn;
  return phase.has("change") || phase.has("touched");
}

/**
 * Creates the asynchronous plug of a form. The form's state is the only thing it holds.
 * @internal
 */
export function createAsyncPlug(core: Core): AsyncPlug {
  const runGlobal = (req: Request, changed: Set<string>): Promise<void> | undefined => {
    const run = core.schemaRun;
    const held = run.window;
    run.window = undefined;
    if (run.timer !== undefined) {
      clearTimeout(run.timer);
      run.timer = undefined;
    }
    // A live (change) pass of a check that answers asynchronously is debounced, and skipped when
    // nothing would show: explicit triggers always run at once.
    if (core.schemaAsync && req.trigger === "change") {
      if (!wantsLive(core)) return undefined;
      const delay = core.opts.debounceMs;
      if (delay > 0) {
        run.controller?.abort();
        run.token += 1;
        const token = run.token;
        // Every change of the window keeps its paths: the pass that finally runs reveals them all, not only the last one's.
        const wide: Request = {
          ...req,
          prefixes: held === undefined ? req.prefixes : widen(held.prefixes, req.prefixes),
        };
        run.window = { prefixes: wide.prefixes };
        return new Promise<void>((resolve) => {
          run.timer = setTimeout(() => {
            run.timer = undefined;
            run.window = undefined;
            if (token !== run.token || core.disposed) {
              resolve();
              return;
            }
            const later = new Set<string>();
            const pending = execute(core, wide, later);
            if (pending === undefined) {
              batch(() => reveal(core, wide, later));
              resolve();
              return;
            }
            void pending.then(() => {
              batch(() => reveal(core, wide, later));
              resolve();
            });
          }, delay);
        });
      }
    }
    return execute(core, req, changed);
  };

  const settleLater = (req: Request, answers: readonly Pending[], token: number): Promise<void> => {
    core.schemaAsync = true;
    core.schemaPending.set(true);
    // The first answer (creation, reset) is not known yet: `isValid()` must not claim validity.
    if (req.trigger === "init") core.unknown.set(true);
    return Promise.all(answers).then((outcomes) => {
      if (token !== core.schemaRun.token || core.disposed) return;
      batch(() => {
        core.schemaPending.set(false);
        const later = new Set<string>();
        applyGlobal(core, outcomes, later);
        reveal(core, req, later);
      });
    });
  };

  const field = (
    rec: Rec,
    req: Request,
    sync: FieldIssue[],
    later: readonly PromiseLike<FieldIssue[]>[],
    controller: AbortController,
    changed: Set<string>,
  ): Promise<void> => {
    const run = { controller };
    rec.run = run;
    setValidatingFlag(core, rec, true);
    if (sync.length > 0 && !issuesEqual(rec.field, sync)) {
      rec.field = sync;
      recomputeTruth(core, rec);
      changed.add(rec.key);
    }
    return Promise.all(later).then((lists) => {
      if (rec.run !== run || core.disposed) return;
      rec.run = undefined;
      batch(() => {
        setValidatingFlag(core, rec, false);
        const all = [...sync, ...lists.flat()];
        const settled = new Set<string>();
        if (!issuesEqual(rec.field, all)) {
          rec.field = all.length === 0 ? NO_ISSUES : all;
          recomputeTruth(core, rec);
        }
        settled.add(rec.key);
        reveal(core, req, settled);
      });
    });
  };

  const debounceField = (
    rec: Rec,
    req: Request,
    delay: number,
    evaluateNow: (later: Set<string>) => Promise<void> | undefined,
  ): Promise<void> =>
    new Promise<void>((resolve) => {
      rec.timer = setTimeout(() => {
        rec.timer = undefined;
        if (core.disposed) {
          resolve();
          return;
        }
        const later = new Set<string>();
        const pending = evaluateNow(later);
        const finish = (): void => {
          batch(() => reveal(core, req, later));
          resolve();
        };
        if (pending === undefined) finish();
        else void pending.then(finish);
      }, delay);
    });

  const cancel = (rec: Rec): void => {
    if (rec.timer !== undefined) {
      clearTimeout(rec.timer);
      rec.timer = undefined;
    }
    if (rec.run !== undefined) {
      rec.run.controller.abort();
      rec.run = undefined;
    }
    setValidatingFlag(core, rec, false);
  };

  const stop = (): void => {
    const run = core.schemaRun;
    run.window = undefined;
    if (run.timer !== undefined) {
      clearTimeout(run.timer);
      run.timer = undefined;
    }
  };

  return {
    runGlobal,
    settleLater,
    syncGlobal: () => {
      core.schemaAsync = false;
      core.schemaPending.set(false);
    },
    field,
    debounceField,
    cancel,
    stop,
  };
}
