/**
 * The field handle: reactive reads of one value and its state, the writers, and the attribute
 * bags for native controls.
 * @packageDocumentation
 */
import { batch, untrack } from "@shadow-js/core";
import { isContainer, plainClone } from "../data";
import { getIn, parsePath, type Segment } from "../path";
import type {
  ControlKind,
  ControlTypes,
  FieldApi,
  FieldIssue,
  IssueInput,
  OptionProps,
  Path,
  PathValue,
  SetValueOptions,
  ValidatorSpec,
} from "../types";
import { remember } from "./cache";
import { Cell } from "./cell";
import { type AnyControlOptions, type Codec, codecFor, kindOfElement } from "./controls";
import { toIssues } from "./issues";
import { peekAt, pushIssues, resetPath, setDisabledFlag, setTouched, writeValue } from "./mutate";
import { readOnly } from "./shape";
import {
  type Binding,
  type Core,
  isDirtyAgainstDefault,
  isUnder,
  type Loc,
  NO_ISSUES,
  pruneBindings,
  type Rec,
  recOfLoc,
  setShown,
  setTouchedFlag,
  slotsOf,
} from "./state";
import { validate, validateSettled } from "./validate";

/**
 * The most prop bags a field keeps (one per kind and option set; radio groups need one per option).
 * @internal
 */
export const MAX_PROP_BAGS = 64;

/** A bound control: its codec and the binding that keeps it in step with the field. */
type Attached = { codec: Codec; binding: Binding };

/** The element an event is about. */
/** A fixed prop, enumerable like the literal it stands in for. */
function constant(value: unknown): PropertyDescriptor {
  return { value, enumerable: true };
}

/** A prop read on each access, so a spread inside an effect reads the current value. */
function getter(get: () => unknown): PropertyDescriptor {
  return { get, enumerable: true };
}

/** True when a field value is the option `value`, compared as text as native options are. */
function isOption(current: unknown, value: unknown): boolean {
  return current !== undefined && current !== null && String(current) === value;
}

function elementOf(event: Event): Element | undefined {
  if (event.currentTarget instanceof Element) return event.currentTarget;
  if (event.target instanceof Element) return event.target;
  return undefined;
}

/**
 * True when a control's value differs from the markup it was rendered with (its `value`,
 * `checked` or selected attribute): the user, or a script, changed it since. The markup is the
 * server's rendering, so a difference means a change nobody has written to the form yet.
 */
function typedSinceMarkup(element: Element): boolean {
  if (element instanceof HTMLSelectElement) {
    // Only markup with a selected option counts: options a component selects through properties
    // have no `selected` attribute, and their selection is not something the user chose.
    const options = Array.from(element.options);
    return (
      options.some((option) => option.hasAttribute("selected")) &&
      options.some((option) => option.selected !== option.defaultSelected)
    );
  }
  if (
    element instanceof HTMLInputElement &&
    (element.type === "checkbox" || element.type === "radio")
  ) {
    return element.checked !== element.defaultChecked;
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value !== element.defaultValue;
  }
  return false;
}

/** Options for a control that was not bound through `props()`, taken from the element itself. */
function optionsOfElement(element: Element, kind: ControlKind): AnyControlOptions {
  if (kind === "radio" && element instanceof HTMLInputElement) {
    return { kind, value: element.value };
  }
  if (kind === "select" && element instanceof HTMLSelectElement) {
    return { kind, multiple: element.multiple };
  }
  if (kind === "file" && element instanceof HTMLInputElement) {
    return { kind, multiple: element.multiple };
  }
  return kind === "number" || kind === "checkbox" ? { kind } : { kind: "text" };
}

/**
 * The pieces of a field the array handle and the form need.
 * @internal
 */
export interface FieldImpl extends FieldApi<unknown> {
  readonly loc: Loc;
  /** Registers a validator for the lifetime of the creating owner. */
  addValidator(spec: ValidatorSpec<unknown, object>): () => void;
}

/**
 * Hooks the factory needs from the form.
 * @internal
 */
export interface FieldHost {
  readonly core: Core;
  /** Creates the handle for a location below another handle's. */
  child(loc: Loc): FieldImpl;
}

function bagKey(kind: ControlKind, options: AnyControlOptions): string {
  const o = options as Record<string, unknown>;
  return [kind, o["value"], o["multiple"], o["empty"], o["trim"], o["invalid"], o["type"], o["as"]]
    .map((part) => (part === undefined ? "" : String(part)))
    .join("\u0001");
}

/**
 * Creates the handle for one location.
 *
 * @param host The form's core and the child factory.
 * @param loc Where the handle points.
 * @returns A handle. Reads are reactive; writers validate according to the form's rules.
 * @internal
 */
export function createField(host: FieldHost, loc: Loc): FieldImpl {
  const core = host.core;
  const rec = (): Rec => recOfLoc(core, loc);
  const peekValue = (): unknown =>
    peekAt(
      core,
      untrack(() => loc.segments()),
    );
  const segmentsNow = (): Segment[] => untrack(() => [...loc.segments()]);
  // A row that was removed reports index -1. Its handles go inert: a read sees nothing and a write
  // changes nothing, so a late answer (a server error, a blur) cannot bring its state back or write
  // a junk key on the array.
  const gone = (): boolean =>
    loc.segments().some((segment) => typeof segment === "number" && segment < 0);
  /** {@link gone} for the writers, which must not subscribe the code that calls them. */
  const goneNow = (): boolean => untrack(gone);

  const states = new WeakMap<Element, Attached>();
  const mine = new Set<Binding>();
  const bags = new Map<string, object>();
  /** Bumped when a composition starts or ends, so the bound `value` re-reads after it. */
  const compositionEpoch = new Cell(0);
  const composingElement = (): Element | undefined => {
    for (const binding of mine) if (binding.composing) return binding.element;
    return undefined;
  };
  const children = new Map<string, FieldImpl>();
  /** The forms that already listen for their native reset (one listener per form, not per control), with how to stop. */
  const resettable = new Map<HTMLFormElement, () => void>();
  /**
   * A native reset empties every file control of its form. The browser clears the files after the
   * "reset" event, so the state of the field becomes undefined here, with the files still in place.
   * A listener whose form was disposed, whose row is gone, or whose file controls all left the form stops here
   * instead of writing into a field nobody shows.
   */
  const onFormReset = (event: Event): void => {
    const form = event.currentTarget;
    const live =
      !core.disposed &&
      !goneNow() &&
      [...mine].some(
        (binding) =>
          binding.element.isConnected &&
          binding.element instanceof HTMLInputElement &&
          binding.element.form === form,
      );
    if (!live) {
      if (form instanceof HTMLFormElement) resettable.get(form)?.();
      return;
    }
    batch(() => writeValue(core, segmentsNow(), undefined, {}));
  };

  const prune = (target: Rec): void => {
    pruneBindings(core, target);
    for (const binding of mine) {
      if (target.bindings?.get(binding.element) !== binding) mine.delete(binding);
    }
  };

  const syncAll = (): void => {
    for (const binding of mine) {
      if (binding.element.isConnected || !binding.attached) binding.sync();
    }
  };

  /** Binds a control to this field (once) and returns its codec and binding. */
  const bind = (element: Element, codec?: Codec): Attached => {
    const target = rec();
    prune(target);
    const kind = kindOfElement(element);
    const use =
      codec ?? codecFor(optionsOfElement(element, kind), core.opts.emptyValue, core.dates);
    const known = target.bindings?.get(element);
    if (known !== undefined) {
      const state = { codec: use, binding: known };
      states.set(element, state);
      return state;
    }
    // A control the server rendered, which the user changed before the form was hydrated, keeps
    // what was typed: the element's value is taken over once, and the initial value is not written
    // over it. An element this form has bound before (a row that moved) is never taken over.
    if (
      !core.boundElements.has(element) &&
      typedSinceMarkup(element) &&
      !use.shows(element, peekValue())
    ) {
      batch(() => writeValue(core, segmentsNow(), use.read(element, peekValue()), {}));
    }
    const binding: Binding = {
      element,
      owner: { key: () => loc.resolve().key },
      composing: false,
      attached: element.isConnected,
      sync: () => {
        if (binding.composing) return;
        const value = peekValue();
        if (!use.shows(element, value)) use.write(element, value);
      },
    };
    target.bindings ??= new Map();
    target.bindings.set(element, binding);
    core.boundKeys.add(target.key);
    core.boundElements.add(element);
    const state = { codec: use, binding };
    states.set(element, state);
    mine.add(binding);
    // Controls are inserted in the same synchronous pass as their `ref`; once it is over, a control
    // that is not on the page was never going to be (or has already left).
    queueMicrotask(() => {
      if (element.isConnected) binding.attached = true;
      // A file control learns its form once it is inserted (the ref can run before that). Only a
      // file control listens for the reset: the other kinds keep their text.
      // The kind was read when the ref ran, before the `type` attribute was applied: read the type now.
      const form =
        element instanceof HTMLInputElement && element.type === "file" ? element.form : null;
      if (form !== null && !core.disposed && !resettable.has(form)) {
        const off = (): void => {
          form.removeEventListener("reset", onFormReset);
          resettable.delete(form);
          core.resetOff.delete(off);
        };
        resettable.set(form, off);
        core.resetOff.add(off);
        form.addEventListener("reset", onFormReset);
      }
    });
    binding.sync();
    return state;
  };

  const register = (element: Element | null, codec?: Codec): void => {
    if (element !== null) bind(element, codec);
  };

  const stateOf = (element: Element): Attached => states.get(element) ?? bind(element);

  const onControl = (event: Event): void => {
    const element = elementOf(event);
    if (element === undefined) return;
    const { codec } = stateOf(element);
    if (goneNow()) return;
    batch(() => {
      writeValue(core, segmentsNow(), codec.read(element, peekValue()), {});
      syncAll();
    });
  };

  const onBlur = (event?: Event): void => {
    const element = event === undefined ? undefined : elementOf(event);
    if (goneNow()) return;
    batch(() => {
      const target = rec();
      setTouchedFlag(core, target, true);
      slotsOf(target).focused.set(false);
      if (element !== undefined && states.get(element)?.binding.composing === true) return;
      validate(core, { trigger: "blur", prefixes: [segmentsNow()] });
    });
  };

  const onFocus = (): void => {
    if (goneNow()) return;
    slotsOf(rec()).focused.set(true);
  };

  const flushComposition = (): void => {
    if (core.composing === 0 && core.deferred !== undefined) {
      const { prefixes } = core.deferred;
      core.deferred = undefined;
      validate(core, { trigger: "change", prefixes });
    }
  };

  const onCompositionStart = (event: Event): void => {
    const element = elementOf(event);
    if (element === undefined) return;
    const { binding } = stateOf(element);
    if (!binding.composing) {
      binding.composing = true;
      core.composing += 1;
      compositionEpoch.set(compositionEpoch.peek() + 1);
    }
  };

  const onCompositionEnd = (event: Event): void => {
    const element = elementOf(event);
    if (element === undefined) return;
    const { codec, binding } = stateOf(element);
    if (binding.composing) {
      binding.composing = false;
      core.composing = Math.max(0, core.composing - 1);
      compositionEpoch.set(compositionEpoch.peek() + 1);
    }
    if (goneNow()) return;
    batch(() => {
      writeValue(core, segmentsNow(), codec.read(element, peekValue()), {});
      flushComposition();
    });
  };

  /** The controls bound to this field that are on the page now. */
  const livingElements = (): Element[] => {
    if (gone()) return [];
    const target = rec();
    prune(target);
    const out: Element[] = [];
    for (const [element, binding] of target.bindings ?? []) {
      if (element.isConnected && binding.owner.key() === target.key) out.push(element);
    }
    return out;
  };
  const isFieldDisabled = (): boolean =>
    core.formDisabled() || (!gone() && slotsOf(rec()).disabled.get());
  const errorsRead = (): readonly FieldIssue[] => (gone() ? NO_ISSUES : slotsOf(rec()).shown.get());
  const idOf = (): string => `${core.id}-${loc.idPath()}`;

  /**
   * Attributes every control gets, as getters so a spread reads them inside its effect. Built once
   * per field; each bag adds its own `id` in front, so the keys keep their order.
   */
  const sharedAttrs: PropertyDescriptorMap = Object.getOwnPropertyDescriptors({
    get name(): string {
      return field.path;
    },
    get disabled(): boolean | undefined {
      return isFieldDisabled() ? true : undefined;
    },
    get "aria-invalid"(): true | undefined {
      return errorsRead().length > 0 ? true : undefined;
    },
    get "aria-describedby"(): string | undefined {
      return errorsRead().length > 0 ? field.errorId : undefined;
    },
    onBlur,
    onFocus,
  });
  const common = (control: string): PropertyDescriptorMap => ({
    id: {
      get: () => (control === "" ? idOf() : `${idOf()}-${control}`),
      enumerable: true,
      configurable: true,
    },
    ...sharedAttrs,
  });

  const buildBag = (kind: ControlKind, options: AnyControlOptions): object => {
    const codec = codecFor(options, core.opts.emptyValue, core.dates);
    const o = options as Record<string, unknown>;
    const text = (): string => codec.display(field.value()) ?? "";
    // While text is being composed the control keeps its own text: a write from elsewhere lands
    // when the composition ends (the epoch cell makes this getter run again then).
    const composedText = (): string => {
      compositionEpoch.get();
      const composing = composingElement();
      const typed: unknown = composing === undefined ? undefined : Reflect.get(composing, "value");
      return typeof typed === "string" ? typed : text();
    };
    const bag = (control: string, extra: PropertyDescriptorMap): object =>
      Object.defineProperties(
        {},
        {
          ...common(control),
          ref: { value: (element: Element | null) => register(element, codec), enumerable: true },
          ...extra,
        },
      );
    const composition: PropertyDescriptorMap = {
      onCompositionStart: constant(onCompositionStart),
      onCompositionEnd: constant(onCompositionEnd),
    };
    switch (kind) {
      case "number":
      case "date":
        return bag("", {
          type: constant(kind === "number" ? "number" : (o["type"] ?? "date")),
          value: getter(text),
          onInput: constant(onControl),
        });
      case "checkbox":
        // Each box of a group has its own id (as radios do), so a `<label for>` finds its box.
        return bag(o["value"] === undefined ? "" : String(o["value"]), {
          type: constant("checkbox"),
          value: constant(o["value"]),
          checked: getter(() => {
            const current = field.value();
            return o["value"] === undefined
              ? current === true
              : Array.isArray(current) && current.includes(o["value"]);
          }),
          onChange: constant(onControl),
        });
      case "radio":
        return bag(String(o["value"] ?? ""), {
          type: constant("radio"),
          value: constant(String(o["value"] ?? "")),
          checked: getter(() => isOption(field.value(), o["value"])),
          onChange: constant(onControl),
        });
      case "select":
        return bag("", {
          multiple: constant(o["multiple"] === true ? true : undefined),
          // A multiple select is selected through its options (see `optionProps`).
          ...(o["multiple"] === true ? {} : { value: getter(text) }),
          onChange: constant(onControl),
        });
      case "file":
        return bag("", {
          type: constant("file"),
          multiple: constant(o["multiple"] === true ? true : undefined),
          onChange: constant(onControl),
        });
      case "textarea":
        return bag("", {
          value: getter(composedText),
          children: getter(text),
          onInput: constant(onControl),
          ...composition,
        });
      default:
        // While text is being composed the control keeps its own text (see `composedText`).
        return bag("", {
          value: getter(composedText),
          onInput: constant(onControl),
          ...composition,
        });
    }
  };

  // `props` is generic in the kind: the overloads say which bag a kind gets, and the body builds
  // the bag for the kind it was given at run time.
  function props<K extends ControlKind = "text">(
    options?: ControlTypes[K]["options"] & { readonly kind?: K },
  ): ControlTypes[K]["props"];
  function props(options?: AnyControlOptions & { readonly kind?: ControlKind }): unknown {
    const kind: ControlKind = options?.kind ?? "text";
    // Without options the control is a text control, the kind the line above gives it.
    const resolved: AnyControlOptions = options ?? { kind: "text" };
    const key = bagKey(kind, resolved);
    return remember(bags, key, () => buildBag(kind, resolved), MAX_PROP_BAGS);
  }

  // `FieldApi.field` at an unknown value types a path as `FieldApi<never>`, as for a row: the
  // overload says so, and the body returns the child handle.
  function childField<P extends Path<NonNullable<unknown>>>(
    path: P,
  ): FieldApi<PathValue<NonNullable<unknown>, P>>;
  function childField(path: string): unknown {
    return remember(
      children,
      path,
      () => host.child(loc.child(parsePath(path))),
      MAX_PROP_BAGS * 4,
    );
  }

  const field: FieldImpl = {
    loc,
    get path(): string {
      const segments = loc.segments();
      return segments.join(".");
    },
    get id(): string {
      return idOf();
    },
    get errorId(): string {
      return `${idOf()}-error`;
    },
    value: () => getIn(core.values, loc.segments()),
    error: () => errorsRead()[0]?.message,
    errors: () => {
      const all = errorsRead();
      return core.opts.criteriaMode === "firstError" ? all.slice(0, 1) : all;
    },
    invalid: () => errorsRead().length > 0,
    touched: () => {
      if (gone()) return false;
      const target = rec();
      if (slotsOf(target).touched.get()) return true;
      if (!isContainer(getIn(core.values, loc.segments()))) return false;
      core.meta.get();
      for (const other of core.recs.values()) {
        if (other.slots?.touched.value === true && isUnder(other.key, target.key)) return true;
      }
      return false;
    },
    dirty: () => !gone() && isDirtyAgainstDefault(core, rec(), getIn(core.values, loc.segments())),
    validating: () => !gone() && slotsOf(rec()).validating.get(),
    disabled: isFieldDisabled,
    focused: () => !gone() && slotsOf(rec()).focused.get(),
    setValue(value: unknown, options?: SetValueOptions) {
      if (goneNow()) return;
      batch(() => {
        // The updater is the caller's code: it must not subscribe the effect that calls `setValue`.
        const next =
          typeof value === "function"
            ? untrack(() => (value as (previous: unknown) => unknown)(plainClone(peekValue())))
            : value;
        writeValue(core, segmentsNow(), next, {
          validate: options?.validate,
          touch: options?.touch,
        });
        syncAll();
      });
    },
    setError(error: IssueInput | readonly IssueInput[] | undefined) {
      if (goneNow()) return;
      batch(() => pushIssues(core, rec(), "manual", toIssues(error, "manual")));
    },
    clearError() {
      if (goneNow()) return;
      batch(() => {
        const target = rec();
        pushIssues(core, target, "server", NO_ISSUES);
        pushIssues(core, target, "manual", NO_ISSUES);
        setShown(core, target, NO_ISSUES);
      });
    },
    setTouched(touched = true) {
      if (goneNow()) return;
      setTouched(core, rec(), touched);
    },
    setDisabled(disabled: boolean) {
      if (goneNow()) return;
      setDisabledFlag(core, rec(), disabled);
    },
    async trigger() {
      if (goneNow()) return true;
      return validateSettled(core, [segmentsNow()]);
    },
    reset() {
      if (goneNow()) return;
      resetPath(core, segmentsNow());
    },
    focus() {
      const first = livingElements().find(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && !("disabled" in element && element.disabled),
      );
      first?.focus();
      return first !== undefined;
    },
    elements: livingElements,
    onInput: onControl,
    onChange: onControl,
    onBlur,
    onFocus,
    props,
    ref: (element: Element | null) => register(element),
    optionProps(value: string): OptionProps {
      // The shape is typed by the first object; the descriptors then make each member read-only
      // (value) or a getter (selected), as they always were.
      const props: OptionProps = { value, selected: false };
      return Object.defineProperties(props, {
        value: readOnly(value),
        selected: {
          get: () => {
            const current = field.value();
            return Array.isArray(current)
              ? current.some((item) => String(item) === value)
              : isOption(current, value);
          },
          enumerable: true,
          configurable: false,
        },
      });
    },
    field: childField,
    addValidator(spec: ValidatorSpec<unknown, object>) {
      const entry = { loc, spec };
      core.handleValidators.add(entry);
      return () => {
        core.handleValidators.delete(entry);
      };
    },
  };

  return field;
}
