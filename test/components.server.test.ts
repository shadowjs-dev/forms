import { createComponent, renderToString } from "@shadow-js/web/server";
import { describe, expect, it } from "vitest";
import { loadFixture } from "./support/compile";

type Fixture = { Profile: (props: Record<string, unknown>) => unknown };
const ssr = await loadFixture<Fixture>("ssr", "components");

const html = (props: Record<string, unknown>): string =>
  renderToString(() => createComponent(ssr.Profile, props));
const ids = (markup: string): string[] =>
  [...markup.matchAll(/ id="([^"]+)"/g)].map((m) => m[1] as string);

describe("components on the server", () => {
  it("[FRM-174] <Form>, <Field> and <FieldArray> render to markup with values, ids and problems", () => {
    const markup = html({
      initial: { name: "Ada", emails: [{ address: "a@x" }, { address: "bad" }] },
      errors: { name: "Name taken", "emails.1.address": "Needs @" },
    });
    expect(markup).toMatch(/<form[^>]*class="profile"/);
    expect(markup).toMatch(/<form[^>]*novalidate/i);
    expect(markup).toMatch(/<input[^>]*data-testid="name"[^>]*value="Ada"/);
    expect(markup).toMatch(/<input[^>]*data-testid="name"[^>]*aria-invalid="true"/);
    expect(markup.match(/data-testid="row"/g)).toHaveLength(2);
    expect(markup).toContain("Needs @");
    expect(markup).toMatch(/<output[^>]*data-testid="context-name"[^>]*>(<!--\[-->)?Ada/);
    expect(markup).toContain('name="emails.1.address"');
    expect(markup).not.toContain('data-testid="empty"');
  });

  it("[FRM-175] an empty list renders the fallback, and ids are stable between two renders of the same page", () => {
    expect(html({ initial: { name: "", emails: [] } })).toMatch(
      /data-testid="empty"[^>]*>(<!--\[-->)?No emails/,
    );
    const first = ids(html({}));
    expect(ids(html({}))).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
    expect(first.length).toBeGreaterThan(3);
  });
});
