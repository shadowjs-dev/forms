import { createRoot, flushSync, useEffect } from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { useUnsavedChangesGuard } from "../src/index";
import { inRoot, makeForm } from "./support/forms";
import { deferred } from "./support/schemas";

describe("useUnsavedChangesGuard", () => {
  it("[FRM-220] blocks while the form differs from its defaults and no submit runs; the blocker takes a router transition", async () => {
    const gate = deferred<void>();
    const form = makeForm({ defaultValues: { a: "x" }, onSubmit: () => gate.promise });
    const guard = inRoot(() => useUnsavedChangesGuard(form, { beforeUnload: false }));
    expect(guard.shouldBlock()).toBe(false);
    expect(guard.blocker({ to: "/elsewhere" })).toBe(false);
    form.field("a").setValue("y");
    expect(guard.shouldBlock()).toBe(true);
    expect(guard.blocker({ to: "/elsewhere" })).toBe(true);
    const pending = form.handleSubmit();
    expect(guard.blocker()).toBe(false);
    gate.resolve();
    await pending;
    expect(guard.blocker()).toBe(true);
    form.reset({ a: "y" });
    expect(guard.blocker()).toBe(false);
  });

  it("[FRM-221] 'also' adds a reason; the blocker does not subscribe, shouldBlock does", () => {
    const form = makeForm({ defaultValues: { a: "x" } });
    let extra = false;
    const guard = inRoot(() =>
      useUnsavedChangesGuard(form, { beforeUnload: false, also: () => extra }),
    );
    expect(guard.shouldBlock()).toBe(false);
    extra = true;
    expect(guard.blocker()).toBe(true);
    extra = false;
    let blockerRuns = 0;
    let flagRuns = 0;
    inRoot(() => {
      useEffect(() => {
        guard.blocker();
        blockerRuns += 1;
      });
      useEffect(() => {
        guard.shouldBlock();
        flagRuns += 1;
      });
    });
    flushSync();
    form.field("a").setValue("changed");
    flushSync();
    expect([blockerRuns, flagRuns]).toEqual([1, 2]);
  });

  it("[FRM-222] the browser prompt is asked for while there are unsaved changes, and the listener goes away with the owner", () => {
    const form = makeForm({ defaultValues: { a: "x" } });
    const dispose = createRoot((stop) => {
      useUnsavedChangesGuard(form);
      return stop;
    });
    const ask = (): Event => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event;
    };
    flushSync();
    expect(ask().defaultPrevented).toBe(false);
    form.field("a").setValue("y");
    expect(ask().defaultPrevented).toBe(true);
    dispose();
    expect(ask().defaultPrevented).toBe(false);
  });
});
