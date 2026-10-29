import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadProduction, messageOf } from "./support/production-build";

type PathModule = typeof import("../src/path");

const CODE = /^FORMS_[A-Z]+(?:_\d+)?$/;

describe("production error codes of the path helpers", () => {
  it("[ERR-CODES-1] every refusal carries a FORMS_ code, and different refusals carry different codes", async () => {
    const path = await loadProduction<PathModule>(join(import.meta.dirname, "../src/path.ts"));
    const messages = {
      emptyPath: messageOf(() => path.parsePath("")),
      syntax: messageOf(() => path.parsePath("a..b")),
      reservedKey: messageOf(() => path.parsePath("a.__proto__")),
      emptyFormat: messageOf(() => path.formatPath([])),
      badIndex: messageOf(() => path.formatPath([-1])),
      dottedKey: messageOf(() => path.formatPath(["a.b"])),
      controlKey: messageOf(() => path.formatPath(["a\u0001"])),
      writeRoot: messageOf(() => path.setIn({}, [], 1)),
      scalarStep: messageOf(() => path.setIn({ a: 1 }, ["a", "b"], 1)),
      notIndex: messageOf(() => path.setIn({ a: [] }, ["a", "x"], 1)),
      farIndex: messageOf(() => path.setIn({ a: [] }, ["a", path.MAX_FILL + 5], 1)),
    };
    for (const [name, message] of Object.entries(messages)) {
      expect(message, name).toMatch(CODE);
    }
    // `emptyFormat` and `emptyPath` are the same refusal (an empty path); every other one differs.
    const distinct = new Set(Object.values(messages));
    expect(distinct.size).toBe(Object.keys(messages).length - 1);
    expect(messages.emptyFormat).toBe(messages.emptyPath);
  });
});
