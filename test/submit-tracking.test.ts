import { flushSync, useEffect, useSignal } from "@shadow-js/core";
import { isTracking } from "@shadow-js/core/extend";
import { describe, expect, it } from "vitest";
import type { SubmitResult } from "../src/types";
import { inRoot, makeForm, settle } from "./support/forms";

describe("submit callback tracking", () => {
  it.each(["configured", "override", "invalid", "configured-invalid"] as const)(
    "[FRM-SUBMIT-TRACK-01] %s callbacks do not subscribe their caller and restore later tracking",
    async (kind) => {
      const [secret, setSecret] = useSignal(0);
      const [tail, setTail] = useSignal(0);
      const tracking: boolean[] = [];
      const callback = (): void => {
        tracking.push(isTracking());
        secret();
      };
      const form = makeForm({
        defaultValues: { value: "ok" },
        validators:
          kind === "invalid" || kind === "configured-invalid"
            ? { value: () => "Required" }
            : undefined,
        onSubmit: callback,
        onInvalid: callback,
      });
      const submit =
        kind === "configured" || kind === "configured-invalid"
          ? () => form.handleSubmit()
          : form.handleSubmitWith(callback, callback);
      let attempted = false;
      let runs = 0;
      inRoot(() => {
        useEffect(() => {
          runs += 1;
          if (!attempted) {
            attempted = true;
            void submit();
          }
          tail();
        });
      });
      flushSync();
      await settle();
      flushSync();
      expect(tracking).toEqual([false]);
      const before = runs;
      setSecret(1);
      flushSync();
      expect(runs).toBe(before);
      setTail(1);
      flushSync();
      expect(runs).toBe(before + 1);
    },
  );

  it.each(["valid", "invalid"] as const)(
    "[FRM-SUBMIT-TRACK-02] a throwing %s callback restores caller tracking and becomes a submit error",
    async (kind) => {
      const [secret, setSecret] = useSignal(0);
      const [tail, setTail] = useSignal(0);
      const failure = new Error("callback failed");
      const tracking: boolean[] = [];
      const callback = (): never => {
        tracking.push(isTracking());
        secret();
        throw failure;
      };
      const form = makeForm({
        defaultValues: { value: "ok" },
        validators: kind === "invalid" ? { value: () => "Required" } : undefined,
      });
      const submit = form.handleSubmitWith(callback, callback);
      let pending: Promise<SubmitResult<{ value: string }>> | undefined;
      let attempted = false;
      let runs = 0;
      inRoot(() => {
        useEffect(() => {
          runs += 1;
          if (!attempted) {
            attempted = true;
            pending = submit();
          }
          tail();
        });
      });
      flushSync();
      expect(await pending).toEqual({ ok: false, reason: "error", error: failure });
      flushSync();
      expect(tracking).toEqual([false]);
      const before = runs;
      setSecret(1);
      flushSync();
      expect(runs).toBe(before);
      setTail(1);
      flushSync();
      expect(runs).toBe(before + 1);
    },
  );
});
