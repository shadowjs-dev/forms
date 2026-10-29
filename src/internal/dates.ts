/**
 * The date family of native controls (`date`, `time`, `month`, `week`, `datetime-local`): the text
 * each one shows and reads, and the epoch milliseconds they stand for. Installed by the `dates`
 * feature (`@shadow-js/forms/dates`); a form without it throws a `TypeError` that names the feature
 * when one of these controls is bound. Kept out of the controls module so a form without dates does
 * not carry the calendar code.
 * @packageDocumentation
 */
import type { DateInputType, DateOptions, EmptyValue } from "../types";
import { type Codec, textOf, textual } from "./controls";
import { emptyOf } from "./empty";

const DAY_MS = 86_400_000;

/**
 * The text shapes of the date-like inputs, by control type. Every shape has seven groups in the
 * same order (year, month, day, hours, minutes, seconds, milliseconds); a group the shape does not
 * have is empty, so the parse reads them all the same way.
 */
const DATE_SHAPES: Partial<Record<DateInputType, RegExp>> = {
  date: /^(\d{4,6})-(\d{2})-(\d{2})$/,
  "datetime-local": /^(\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
  time: /^()()()(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
  month: /^(\d{4,6})-(\d{2})$/,
};

/** The controls whose calendar is UTC; `datetime-local` has no offset, so it reads local time. */
const IS_UTC: Partial<Record<DateInputType, boolean>> = { date: true, month: true };

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** `hh:mm`, with `:ss` only when the seconds are not zero (the shortest text the HTML syntax allows). */
function clock(hours: number, minutes: number, seconds: number): string {
  const text = `${pad(hours)}:${pad(minutes)}`;
  return seconds === 0 ? text : `${text}:${pad(seconds)}`;
}

/**
 * One instant of a calendar day, in UTC or in local time. The fields are set after construction:
 * `Date.UTC` and the `Date` constructor map years 0 to 99 to 1900 to 1999, which HTML's date syntax
 * (years 0001 to 9999) does not, and setting the time after the day keeps the day exact.
 */
function instant(
  utc: boolean,
  [y = 0, mo = 0, d = 1, h = 0, mi = 0, s = 0, ms = 0]: number[],
): Date {
  const date = new Date(0);
  if (utc) {
    date.setUTCFullYear(y, mo, d);
    date.setUTCHours(h, mi, s, ms);
  } else {
    date.setFullYear(y, mo, d);
    date.setHours(h, mi, s, ms);
  }
  return date;
}

/** The year, month (0 to 11), day, hours, minutes and seconds of an instant, in UTC or local time. */
function fieldsOf(date: Date, utc: boolean): [number, number, number, number, number, number] {
  return utc
    ? [
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
      ]
    : [
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getSeconds(),
      ];
}

/**
 * Epoch milliseconds for the text of a date-like input, or NaN. `date` is read as UTC midnight,
 * `datetime-local` as local time (ECMAScript's reading of date-time text without an offset), and
 * a day that the calendar does not have (February 30) is NaN.
 * @internal
 */
export function parseDateText(type: DateInputType, text: string): number {
  const m = DATE_SHAPES[type]?.exec(text);
  if (!m) return Number.NaN;
  const [y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0] = [1, 2, 3, 4, 5, 6].map((i) =>
    Number(m[i] ?? 0),
  );
  const ms = Number((m[7] ?? "0").padEnd(3, "0"));
  if (type === "time") {
    if (h > 23 || mi > 59 || s > 59) return Number.NaN;
    return ((h * 60 + mi) * 60 + s) * 1000 + ms;
  }
  if (type === "month") {
    return mo >= 1 && mo <= 12 ? instant(true, [y, mo - 1, 1]).getTime() : Number.NaN;
  }
  // A calendar day that the Date object moved (February 30 rolls into March) is not a date.
  const utc = IS_UTC[type] === true;
  const date = instant(utc, [y, mo - 1, d, h, mi, s, ms]);
  const [yy, mm, dd] = fieldsOf(date, utc);
  return yy === y && mm === mo - 1 && dd === d ? date.getTime() : Number.NaN;
}

/**
 * The text a date-like input shows for epoch milliseconds, or `""` when they are not a date.
 * @internal
 */
export function formatDateText(type: DateInputType, ms: number): string {
  if (!Number.isFinite(ms)) return "";
  if (type === "time") {
    const total = Math.floor((((ms % DAY_MS) + DAY_MS) % DAY_MS) / 1000);
    return clock(Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60);
  }
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const [y, mo, d, h, mi, s] = fieldsOf(date, IS_UTC[type] === true);
  const day = `${pad(y, 4)}-${pad(mo + 1)}-${pad(d)}`;
  if (type === "date") return day;
  if (type === "month") return day.slice(0, -3);
  if (type === "datetime-local") return `${day}T${clock(h, mi, s)}`;
  return "";
}

export function dateCodec(options: DateOptions, emptyValue: EmptyValue): Codec {
  const type = options.type ?? "date";
  const as = options.as ?? "string";
  if (type === "week" && as !== "string") {
    throw new TypeError(
      __DEV__ ? '[forms] a "week" input can only be stored as a string' : "FORMS_WEEK",
    );
  }
  const empty = options.empty ?? emptyValue;
  const display = (value: unknown): string => {
    if (typeof value === "string") return value;
    const ms = value instanceof Date ? value.getTime() : value;
    return typeof ms === "number" ? formatDateText(type, ms) : "";
  };
  const read = (element: Element): unknown => {
    const text = textOf(element);
    if (text === "") return as === "string" ? emptyOf(empty) : undefined;
    if (as === "string") return text;
    const ms = parseDateText(type, text);
    if (Number.isNaN(ms)) return undefined;
    return as === "date" ? new Date(ms) : ms;
  };
  return textual(read, display, (element, value) => textOf(element) === display(value));
}

// ---------------------------------------------------------------------------------------------
