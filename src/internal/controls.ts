/**
 * How native controls turn into values and back. A codec knows three things about a kind of
 * control: what value the control would store (`read`), how to show a value (`write`), and whether
 * the control already shows it (`shows`), so that typing never rewrites what the user is editing.
 * @packageDocumentation
 */

import type {
  CheckboxOptions,
  ControlKind,
  DateOptions,
  EmptyValue,
  FileOptions,
  NumberOptions,
  RadioOptions,
  SelectOptions,
  TextareaOptions,
  TextOptions,
} from "../types";
import { emptyOf } from "./empty";
import { missingFeature } from "./issues";

/**
 * The codec of the date family, installed by the `dates` feature (`internal/dates.ts`).
 * @internal
 */
export interface DatesPlug {
  /** The codec of a date, time, month, week or datetime-local control. */
  codec(options: DateOptions, emptyValue: EmptyValue): Codec;
}

/**
 * Reads, writes and compares one kind of control.
 * @internal
 */
export interface Codec {
  /** The value the control stands for. `previous` is the stored value (checkbox groups need it). */
  read(element: Element, previous: unknown): unknown;
  /** Shows `value` in the control. */
  write(element: Element, value: unknown): void;
  /** True when the control already stands for `value`. */
  shows(element: Element, value: unknown): boolean;
  /** The text for the `value` attribute (text-like kinds), or `undefined`. */
  display(value: unknown): string | undefined;
}

type ValuedElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isValued(element: Element): element is ValuedElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}

/** The current text of a control. */
export function textOf(element: Element): string {
  return isValued(element) ? element.value : (element.textContent ?? "");
}

function setText(element: Element, text: string): void {
  if (isValued(element)) element.value = text;
  else element.textContent = text;
}

/** The text of a value that a text-like control shows: strings, and finite numbers and booleans. */
function plainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return typeof value === "number" || typeof value === "boolean" || typeof value === "bigint"
    ? String(value)
    : "";
}

/**
 * A codec for a control that shows its value as text: `write` rewrites the text only when it
 * differs, so the caret of a control the user is typing in stays where it is.
 */
export function textual(
  read: Codec["read"],
  display: (value: unknown) => string,
  shows: Codec["shows"],
): Codec {
  return {
    read,
    display,
    write(element, value) {
      const text = display(value);
      if (textOf(element) !== text) setText(element, text);
    },
    shows,
  };
}

// ---------------------------------------------------------------------------------------------
// text, textarea and single select
// ---------------------------------------------------------------------------------------------

function scalarCodec(empty: EmptyValue, trim: boolean): Codec {
  const read = (element: Element): unknown => {
    const raw = textOf(element);
    const text = trim ? raw.trim() : raw;
    return text === "" ? emptyOf(empty) : text;
  };
  // Compare what the control would store, so "  a " with trimming and "" with an `undefined`
  // policy count as shown.
  return textual(read, plainText, (element, value) => {
    return Object.is(read(element), value) || textOf(element) === plainText(value);
  });
}

// ---------------------------------------------------------------------------------------------
// number
// ---------------------------------------------------------------------------------------------

/** The text a number control shows for a stored value: numbers and numeric text, otherwise nothing. */
function numberText(value: unknown): string {
  if (typeof value === "number") return Number.isNaN(value) ? "" : String(value);
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)))
    return value;
  return "";
}

function numberCodec(options: NumberOptions): Codec {
  const empty = options.empty ?? "undefined";
  const invalid = options.invalid ?? "undefined";
  const read = (element: Element): unknown => {
    const text = textOf(element).trim();
    if (text === "") return empty === "null" ? null : undefined;
    const parsed = Number(text);
    if (Number.isNaN(parsed)) return invalid === "nan" ? Number.NaN : undefined;
    return parsed;
  };
  return textual(read, numberText, (element, value) => {
    // A control stands for "nothing" (empty, or text that is not a number) when the stored value
    // shows no text; otherwise the text must match what is stored.
    const text = numberText(value);
    if (text === "") return numberText(read(element)) === "";
    return Object.is(read(element), Number(text));
  });
}

// ---------------------------------------------------------------------------------------------
// checkbox and radio
// ---------------------------------------------------------------------------------------------

/** A codec for a checked control: `wants` is the checked state a stored value calls for. */
function checkedCodec(
  read: Codec["read"],
  display: Codec["display"],
  wants: (value: unknown) => boolean,
): Codec {
  return {
    read,
    display,
    write(element, value) {
      if (!(element instanceof HTMLInputElement)) return;
      const next = wants(value);
      if (element.checked !== next) element.checked = next;
    },
    shows(element, value) {
      return !(element instanceof HTMLInputElement) || element.checked === wants(value);
    },
  };
}

function checkboxCodec(options: CheckboxOptions): Codec {
  const member = options.value;
  const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
  return checkedCodec(
    (element, previous) => {
      const checked = element instanceof HTMLInputElement && element.checked;
      if (member === undefined) return checked;
      const current = list(previous);
      if (checked) return current.includes(member) ? current : [...current, member];
      return current.filter((item) => item !== member);
    },
    () => member,
    (value) => (member === undefined ? value === true : list(value).includes(member)),
  );
}

function radioCodec(options: RadioOptions): Codec {
  return checkedCodec(
    () => options.value,
    () => options.value,
    (value) => value !== undefined && value !== null && String(value) === options.value,
  );
}

// ---------------------------------------------------------------------------------------------
// select (multiple)
// ---------------------------------------------------------------------------------------------

function selectedValues(element: Element): string[] {
  if (!(element instanceof HTMLSelectElement)) return [];
  return Array.from(element.options)
    .filter((option) => option.selected)
    .map((option) => option.value);
}

function multipleSelectCodec(): Codec {
  const wanted = (value: unknown): readonly string[] =>
    Array.isArray(value) ? value.map((item) => String(item)) : [];
  return {
    read: (element) => selectedValues(element),
    display: () => undefined,
    write(element, value) {
      if (!(element instanceof HTMLSelectElement)) return;
      const set = new Set(wanted(value));
      for (const option of Array.from(element.options)) {
        const next = set.has(option.value);
        if (option.selected !== next) option.selected = next;
      }
    },
    shows(element, value) {
      const current = selectedValues(element);
      const target = wanted(value);
      return current.length === target.length && current.every((item) => target.includes(item));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// file
// ---------------------------------------------------------------------------------------------

function filesOf(element: Element): File[] {
  if (!(element instanceof HTMLInputElement) || element.files === null) return [];
  return Array.from(element.files);
}

function fileCodec(options: FileOptions): Codec {
  const multiple = options.multiple === true;
  const wanted = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    return value === undefined || value === null ? [] : [value];
  };
  return {
    read(element) {
      const files = filesOf(element);
      return multiple ? files : files[0];
    },
    display: () => undefined,
    write(element, value) {
      // A file input cannot be given files; the only thing code may do is clear it.
      if (!(element instanceof HTMLInputElement)) return;
      if (wanted(value).length === 0 && filesOf(element).length > 0) element.value = "";
    },
    shows(element, value) {
      const current = filesOf(element);
      const target = wanted(value);
      if (target.length === 0) return current.length === 0;
      return current.length === target.length && current.every((file, i) => file === target[i]);
    },
  };
}

/**
 * Options of any kind, as the codec factory takes them.
 * @internal
 */
export type AnyControlOptions =
  | TextOptions
  | TextareaOptions
  | NumberOptions
  | CheckboxOptions
  | RadioOptions
  | SelectOptions
  | FileOptions
  | DateOptions;

/**
 * The codec for a kind of control.
 * @param kind Which control.
 * @param options Options of that kind.
 * @param emptyValue The form's policy for empty text.
 * @internal
 */
export function codecFor(
  options: AnyControlOptions,
  emptyValue: EmptyValue,
  dates: DatesPlug | undefined,
): Codec {
  // The options carry their kind, so the switch narrows them without a cast. A text control (and
  // a textarea, which reads and writes text the same way) takes the default branch.
  switch (options.kind) {
    case "number":
      return numberCodec(options);
    case "checkbox":
      return checkboxCodec(options);
    case "radio":
      return radioCodec(options);
    case "select":
      return options.multiple === true
        ? multipleSelectCodec()
        : scalarCodec(options.empty ?? emptyValue, false);
    case "file":
      return fileCodec(options);
    case "date":
      // The date family (date, time, month, week, datetime-local) is the `dates` feature.
      if (dates === undefined) {
        throw new TypeError(
          missingFeature(
            __DEV__ ? "a date, time, month, week or datetime-local control" : "FORMS_NEED_3",
            "dates",
            "dates",
          ),
        );
      }
      return dates.codec(options, emptyValue);
    default:
      return scalarCodec(options.empty ?? emptyValue, options.trim === true);
  }
}

/**
 * The kind of control an element is, when it was not bound with `props()`.
 * @internal
 */
export function kindOfElement(element: Element): ControlKind {
  if (element instanceof HTMLSelectElement) return "select";
  if (element instanceof HTMLInputElement) {
    switch (element.type) {
      case "number":
      case "range":
        return "number";
      case "checkbox":
        return "checkbox";
      case "radio":
        return "radio";
      case "file":
        return "file";
      default:
        return "text";
    }
  }
  return "text";
}
