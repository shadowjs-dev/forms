/** Findings of the router-data audit: each test asserts what the code returns. */
import { describe, expect, it } from "vitest";
import { formDataToValues } from "../src/form-data";

const parse = (text: string): unknown =>
  (
    formDataToValues(new URLSearchParams({ born: text }), { defaults: { born: new Date(0) } }) as {
      born: unknown;
    }
  ).born;

describe("a Date field of a posted form", () => {
  it.each(["abc 1", "1", "12", "foo 12", "2024-02-30", "2024-04-31", "2023-02-29"])(
    "[FRM-A5] the text %j is not a date: it becomes undefined, as the options say",
    (text) => {
      expect(parse(text)).toBeUndefined();
    },
  );

  it.each([
    ["2024-01-05", Date.UTC(2024, 0, 5)],
    ["2024-02-29", Date.UTC(2024, 1, 29)],
    ["2024-01", Date.UTC(2024, 0, 1)],
    ["2024-01-05T10:20:30Z", Date.UTC(2024, 0, 5, 10, 20, 30)],
    ["2024-01-05T10:20:30.5+03:00", Date.UTC(2024, 0, 5, 7, 20, 30, 500)],
    ["Jun 2024", new Date("Jun 2024").getTime()],
    ["5/6/2024", new Date("5/6/2024").getTime()],
  ])("[FRM-A6] the text %j stays a Date", (text, time) => {
    expect((parse(text) as Date).getTime()).toBe(time);
  });
});
