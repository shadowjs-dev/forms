# Changelog

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
