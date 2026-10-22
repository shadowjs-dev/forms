/**
 * DOM helpers for the control codec suites: elements are created by hand and bound through a
 * field's `props(...)` bag, the way a spread in JSX would bind them. Nothing here is a codec.
 */
import type { BaseControlProps } from "../../src/index";

/** Appends an element to the document, so it counts as attached (the way a mounted control does). */
export function mount<T extends HTMLElement>(element: T): T {
  document.body.append(element);
  return element;
}

/** An `<input>` of the given type, mounted. */
export function inputOf(type: string): HTMLInputElement {
  const element = document.createElement("input");
  element.type = type;
  return mount(element);
}

/** An `<option>`; without a value the option's value is its text, as in the DOM. */
export function optionOf(text: string, value?: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.textContent = text;
  if (value !== undefined) element.value = value;
  return element;
}

/** A mounted `<select>` holding the given options. */
export function selectOf(...options: HTMLOptionElement[]): HTMLSelectElement {
  const element = document.createElement("select");
  for (const option of options) element.append(option);
  return mount(element);
}

/**
 * Mounts the element if needed, registers it through the bag's `ref` (the sync that writes the
 * stored value into it) and wires blur. Returns the element.
 */
export function bindValue<E extends HTMLElement>(element: E, props: BaseControlProps): E {
  if (!element.isConnected) document.body.append(element);
  props.ref(element);
  element.addEventListener("blur", props.onBlur);
  return element;
}

/** The values of the selected options, in option order. Reads the `selected` flags (happy-dom caches `selectedOptions`). */
export function selectedOf(select: HTMLSelectElement): string[] {
  return Array.from(select.options)
    .filter((option) => option.selected)
    .map((option) => option.value);
}
