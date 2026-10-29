# Changelog

## 1.0.3

### Fixed

- `formDataToValues` and `parseFormData` coerce a row past the end of a defaults array like the first default row (numbers, checkboxes, lists posted once).
- A `multiple` file input with no file now gives an empty list instead of `[undefined]`.
- Smaller bundles with the same behavior. Production builds of table, query and virtual throw short codes (`TABLE_DUPLICATE`, `QUERY_LIMIT`, `VIRTUAL_KERNEL`) instead of the development messages; each package's README lists them.

## 1.0.2

### Fixed

- The handle of a row that was removed is inert: a late `setValue`, `setError`, `setTouched` or blur no longer writes a junk `-1` key on the array, marks the form invalid with an error nobody can see, or brings back the state the removal deleted.
- The resolver, the form rule, the field validators and the `setValue` updater run untracked, so the effect that causes a pass no longer subscribes to what they read.
- `trigger()` (form and field, so `useWizard` too) runs again when an edit superseded its pass, instead of reporting a clean form while the newer pass is still deciding (at most 8 rounds).
- `issuesToErrors` no longer throws for a path named like an `Object.prototype` member (`toString`, `valueOf`).
- `setIn` refuses a negative, fractional or NaN index, `deleteIn` no longer removes the first item for the path `list.length`, and `replace()` with an item the form refuses keeps the rows and their state.
- `formDataToValues` reads only finite decimal text into a number field (not `Infinity`, `1e999`, `0x10`) and skips a name that clashes with one already read in either order.
- `useWizard` treats a NaN step as the first step.
- A debounced schema or form validator keeps the paths of every change in its quiet period, so two `setValue` calls in one window no longer leave the first field's problem hidden.
- `unregister("items.0")` removes the row with the item, so the rows after it keep their keys and state instead of shifting onto the wrong values.
- `field(path, { validate })` after the handle cache evicted the path no longer registers the validator a second time.
- The `reset` listener a file control puts on its form is removed when the form is disposed, and a reset after the control or the row is gone writes nothing.
- `formDataToValues` no longer creates a row for an unchecked checkbox when the defaults have more rows with text or number fields than the post.
- A posted number no longer costs quadratic time: the decimal pattern split a run of digits several ways, so a long digit string that was not a number held the event loop for seconds (`formDataToValues`, `parseForm`). It is linear now and accepts the same text.

## 1.0.1

### Changed

- Released at 1.0.1 with the other packages, which share one version. No change to this package.

## 1.0.0

### Fixed

- Run synchronous submission and invalid-submission callbacks untracked, preserving the caller's reactive dependencies.
- Route configured invalid-submission callback failures through the shared submit error handling instead of rejecting `handleSubmit()`.

### Added

- Typed form values and field paths, controlled bindings, validation and submission.
- Optional field arrays, async validation, submission errors, Standard Schema integration and date codecs.
- Components and helpers for form context, multi-step flows and navigation guards.
