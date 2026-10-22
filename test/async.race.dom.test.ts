import { afterEach, describe, expect, it, vi } from "vitest";
import { makeForm, settle } from "./support/forms";
import type { Deferred } from "./support/schemas";
import { deferred } from "./support/schemas";

afterEach(() => {
  vi.useRealTimers();
});

describe("async validation races", () => {
  it("[FRM-800] a resolver answer for an older value that arrives last is dropped: only the newest answer applies", async () => {
    const checks: Array<{ user: string; gate: Deferred<string | undefined> }> = [];
    const form = makeForm<{ user: string }>({
      defaultValues: { user: "" },
      validateOn: "change",
      resolver: {
        validate: (values) => {
          const { user } = values as { user: string };
          const gate = deferred<string | undefined>();
          checks.push({ user, gate });
          return gate.promise.then((message) =>
            message === undefined ? { value: { user } } : { issues: [{ path: ["user"], message }] },
          );
        },
      },
    });
    form.field("user").setValue("a");
    form.field("user").setValue("ab");
    const forA = checks.find((check) => check.user === "a");
    const forAb = checks.find((check) => check.user === "ab");
    expect([forA !== undefined, forAb !== undefined]).toEqual([true, true]);
    forAb?.gate.resolve("ab is taken");
    await settle();
    expect(form.field("user").error()).toBe("ab is taken");
    expect(form.isValidating()).toBe(false);
    forA?.gate.resolve("a is taken");
    await settle();
    expect(form.field("user").error()).toBe("ab is taken");
    expect(form.isValid()).toBe(false);
  });

  it("[FRM-801] every new run aborts the previous signal of the resolver and of the form validate rule; the newest run is not aborted", () => {
    const resolverSignals: AbortSignal[] = [];
    const ruleSignals: AbortSignal[] = [];
    const form = makeForm<{ user: string }>({
      defaultValues: { user: "" },
      validateOn: "change",
      resolver: {
        validate: (_values, context) => {
          resolverSignals.push(context.signal);
          return new Promise<never>(() => undefined);
        },
      },
      validate: (_values, context) => {
        ruleSignals.push(context.signal);
        return new Promise<never>(() => undefined);
      },
    });
    form.field("user").setValue("a");
    form.field("user").setValue("ab");
    expect(resolverSignals.map((signal) => signal.aborted)).toEqual([true, true, false]);
    expect(ruleSignals.map((signal) => signal.aborted)).toEqual([true, true, false]);
  });

  it("[FRM-802] a check that started after the quiet period is aborted by the next change; the next check waits its own quiet period and the old answer is ignored", async () => {
    vi.useFakeTimers();
    const checks: Array<{
      value: string;
      signal: AbortSignal;
      gate: Deferred<string | undefined>;
    }> = [];
    const form = makeForm({
      defaultValues: { user: "" },
      validateOn: "change",
      validators: {
        user: {
          debounceMs: 100,
          validate: (value: string, context) => {
            const gate = deferred<string | undefined>();
            checks.push({ value, signal: context.signal, gate });
            return gate.promise;
          },
        },
      },
    });
    const user = form.field("user");
    user.setValue("a");
    vi.advanceTimersByTime(100);
    expect(checks.map((check) => check.value)).toEqual(["a"]);
    expect(user.validating()).toBe(true);
    user.setValue("ab");
    expect(checks[0]?.signal.aborted).toBe(true);
    expect(user.validating()).toBe(false);
    vi.advanceTimersByTime(99);
    expect(checks.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(checks.map((check) => check.value)).toEqual(["a", "ab"]);
    checks[0]?.gate.resolve("a is taken");
    await settle();
    expect(user.error()).toBeUndefined();
    expect([user.validating(), form.isValidating()]).toEqual([true, true]);
    checks[1]?.gate.resolve(undefined);
    await settle();
    expect(user.error()).toBeUndefined();
    expect([user.validating(), form.isValidating()]).toEqual([false, false]);
  });

  it("[FRM-803] isValidating is false during the quiet period (no check runs yet), true while the check runs, and a superseded check that never settles does not keep it true", async () => {
    vi.useFakeTimers();
    const gate = deferred<undefined>();
    const debounced = makeForm({
      defaultValues: { user: "" },
      validateOn: "change",
      validators: { user: { debounceMs: 50, validate: () => gate.promise } },
    });
    debounced.field("user").setValue("x");
    expect(debounced.isValidating()).toBe(false);
    vi.advanceTimersByTime(50);
    expect(debounced.isValidating()).toBe(true);
    gate.resolve(undefined);
    await settle();
    expect(debounced.isValidating()).toBe(false);

    const superseded = makeForm({
      defaultValues: { user: "" },
      validateOn: "change",
      validators: {
        user: (value: string) =>
          value === "stuck" ? new Promise<undefined>(() => undefined) : Promise.resolve(undefined),
      },
    });
    superseded.field("user").setValue("stuck");
    expect(superseded.isValidating()).toBe(true);
    superseded.field("user").setValue("fine");
    await settle();
    expect(superseded.isValidating()).toBe(false);
    expect(superseded.field("user").error()).toBeUndefined();
  });

  it("[FRM-804] a rejected resolver or validate rule becomes a form-level problem, and a synchronous throw of the rule does too", async () => {
    const rejecting = makeForm<{ user: string }>({
      defaultValues: { user: "x" },
      resolver: { validate: () => Promise.reject(new Error("schema service down")) },
    });
    expect(await rejecting.trigger()).toBe(false);
    expect(rejecting.formErrors().map((issue) => issue.message)).toEqual(["schema service down"]);
    expect(rejecting.isValidating()).toBe(false);

    const rule = makeForm({
      defaultValues: { user: "x" },
      validate: () => Promise.reject(new Error("rule service down")),
    });
    expect(await rule.trigger()).toBe(false);
    expect(rule.formErrors().map((issue) => issue.message)).toEqual(["rule service down"]);

    const broken = makeForm({
      defaultValues: { user: "x" },
      validate: () => {
        throw new Error("rule broke");
      },
    });
    expect(await broken.trigger()).toBe(false);
    expect(broken.formErrors().map((issue) => issue.message)).toEqual(["rule broke"]);
  });

  it("[FRM-805] a promised form-level answer that is malformed becomes a form problem, as a synchronous malformed answer does", async () => {
    const sync = makeForm({
      defaultValues: { user: "x" },
      validate: () => ({ user: 5 }) as unknown as undefined,
    });
    await sync.trigger();
    expect(sync.formErrors().map((issue) => issue.message)).toEqual([
      expect.stringMatching(/must return a message/),
    ]);

    const promised = makeForm({
      defaultValues: { user: "x" },
      validate: () => Promise.resolve({ user: 5 }) as unknown as Promise<undefined>,
    });
    await promised.trigger();
    expect(promised.formErrors().map((issue) => issue.message)).toEqual([
      expect.stringMatching(/must return a message/),
    ]);
    expect(promised.isValidating()).toBe(false);

    // A resolver issue without a path is malformed: as a promise it is still one form problem.
    const resolved = makeForm<{ user: string }>({
      defaultValues: { user: "x" },
      resolver: {
        validate: () =>
          Promise.resolve({ issues: [{ message: "no path" }] } as unknown as {
            value: { user: string };
          }),
      },
    });
    expect(await resolved.trigger()).toBe(false);
    expect(resolved.formErrors()).toHaveLength(1);
    expect(resolved.isValidating()).toBe(false);
  });

  it("[FRM-806] a rejected check that was superseded is ignored, and a field's rejection shows only while it is the newest check", async () => {
    const checks: Array<{ value: string; gate: Deferred<string | undefined> }> = [];
    const form = makeForm({
      defaultValues: { user: "" },
      validateOn: "change",
      validators: {
        user: (value: string) => {
          const gate = deferred<string | undefined>();
          checks.push({ value, gate });
          return gate.promise;
        },
      },
    });
    form.field("user").setValue("a");
    form.field("user").setValue("ab");
    checks[1]?.gate.resolve(undefined);
    await settle();
    checks[0]?.gate.reject(new Error("old check failed"));
    await settle();
    expect(form.field("user").error()).toBeUndefined();
    expect(form.isValidating()).toBe(false);

    form.field("user").setValue("abc");
    checks[2]?.gate.reject(new Error("network down"));
    await settle();
    expect(form.field("user").error()).toBe("network down");
    expect(form.field("user").validating()).toBe(false);
  });

  it("[FRM-807] trigger() runs a debounced check at once and cancels its quiet period: the debounced run never starts", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const form = makeForm({
      defaultValues: { user: "" },
      validateOn: "change",
      validators: {
        user: {
          debounceMs: 300,
          validate: (value: string) => {
            calls.push(value);
            return undefined;
          },
        },
      },
    });
    form.field("user").setValue("typed");
    expect(await form.trigger("user")).toBe(true);
    expect(calls).toEqual(["typed"]);
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual(["typed"]);
  });

  it("[FRM-808] disposing the form during a quiet period cancels the debounced check: it never starts and nothing is written", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const form = makeForm({
      defaultValues: { user: "" },
      validateOn: "change",
      validators: {
        user: {
          debounceMs: 100,
          validate: (value: string) => {
            calls.push(value);
            return "never shown";
          },
        },
      },
    });
    form.field("user").setValue("typed");
    form.dispose();
    vi.advanceTimersByTime(1000);
    await settle();
    expect(calls).toEqual([]);
    expect(form.field("user").error()).toBeUndefined();
  });

  it("[FRM-809] a submit cancels the quiet period of a pending debounced schema pass and decides on the current values", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const form = makeForm<{ user: string }>({
      defaultValues: { user: "ok" },
      validateOn: "change",
      debounceMs: 200,
      resolver: {
        validate: (values) => {
          const { user } = values as { user: string };
          seen.push(user);
          const answer =
            user === "taken"
              ? { issues: [{ path: ["user"], message: "Taken" }] }
              : { value: { user } };
          return Promise.resolve(answer);
        },
      },
      onSubmit: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(0);
    form.field("user").setValue("taken");
    expect(seen).toEqual(["ok"]);
    const result = await form.handleSubmit();
    expect(seen).toEqual(["ok", "taken"]);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(form.field("user").error()).toBe("Taken");
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual(["ok", "taken"]);
  });
});
