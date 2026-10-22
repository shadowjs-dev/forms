import { createComponent, hydrate } from "@shadow-js/web";
import { createComponent as createServerComponent, renderToString } from "@shadow-js/web/server";

/** The result of rendering a fixture on the server and hydrating it on the client. */
export interface HydrationResult {
  /** The markup the server produced. */
  readonly html: string;
  /** The container holding the hydrated DOM. */
  readonly host: HTMLElement;
  /** Every element the server markup contained, in document order, before hydration. */
  readonly serverElements: readonly Element[];
  /** Removes the container. */
  dispose(): void;
}

type Component = (props: Record<string, unknown>) => unknown;

/** Renders `ssr` to a string, hydrates it with `dom`, and returns both so a test can compare. */
export function ssrAndHydrate(
  ssr: Component,
  dom: Component,
  props: Record<string, unknown> = {},
  beforeHydrate?: (host: HTMLElement) => void,
): HydrationResult {
  const html = renderToString(() => createServerComponent(ssr, props));
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  const serverElements = [...host.querySelectorAll("*")];
  // Runs after the server markup is in the page and before hydration: a user typing there
  // (a value set on a control) must survive the hydration.
  beforeHydrate?.(host);
  const stop = hydrate(() => createComponent(dom, props), host);
  return {
    html,
    host,
    serverElements,
    dispose() {
      if (typeof stop === "function") stop();
      host.remove();
    },
  };
}
