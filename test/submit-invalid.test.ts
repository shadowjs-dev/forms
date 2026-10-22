import { describe, expect, it, vi } from "vitest";
import type { FormIssue } from "../src/types";
import { makeForm } from "./support/forms";

describe("configured invalid-submit callbacks", () => {
  it.each([new Error("invalid handler failed"), "invalid handler failed", null])(
    "[FRM-SUBMIT-INVALID-01] a thrown callback value becomes a submit error instead of rejecting (%s)",
    async (failure) => {
      const event = new Event("submit", { cancelable: true });
      const onInvalid = vi.fn(
        (issues: readonly FormIssue[], context: { event: Event | undefined }) => {
          expect(issues).toEqual([expect.objectContaining({ path: "value", message: "Required" })]);
          expect(context.event).toBe(event);
          throw failure;
        },
      );
      const form = makeForm({
        defaultValues: { value: "" },
        validators: { value: () => "Required" },
        onInvalid,
      });
      await expect(form.handleSubmit(event)).resolves.toEqual({
        ok: false,
        reason: "error",
        error: failure,
      });
      expect(onInvalid).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      expect(form.submitError()?.cause).toBe(failure);
      expect(form.isSubmitting()).toBe(false);
      expect(form.isSubmitSuccessful()).toBe(false);
      expect(form.field("value").error()).toBe("Required");
    },
  );

  it("[FRM-SUBMIT-INVALID-02] a successful invalid callback keeps the invalid outcome and field issues", async () => {
    const onInvalid = vi.fn();
    const form = makeForm({
      defaultValues: { value: "" },
      validators: { value: () => "Required" },
      onInvalid,
    });
    expect(await form.handleSubmit()).toEqual({ ok: false, reason: "invalid" });
    expect(onInvalid).toHaveBeenCalledExactlyOnceWith(
      [expect.objectContaining({ path: "value", message: "Required" })],
      { event: undefined },
    );
    expect(form.submitError()).toBeUndefined();
    expect(form.field("value").error()).toBe("Required");
  });
});
