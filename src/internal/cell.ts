import {
  createSignalNode,
  type Equals,
  readSignal,
  type SignalNode,
  writeSignal,
} from "@shadow-js/core/extend";

/**
 * One reactive value: a thin wrapper over the engine's signal node, without the closures
 * `useSignal` allocates. A form keeps many of these (per field and flag), so they stay small and
 * are created only when a field's state is first needed.
 * @internal
 */
export class Cell<T> {
  readonly #node: SignalNode<T>;

  constructor(value: T, equals: Equals<T> = Object.is) {
    this.#node = createSignalNode<T>(value, equals);
  }

  /** Reads the value and subscribes the running computation. */
  get(): T {
    return readSignal(this.#node);
  }

  /** Reads the value without subscribing. */
  peek(): T {
    return this.#node.value;
  }

  /** Stores `next`; readers are notified when it differs by the cell's equality. */
  set(next: T): boolean {
    return writeSignal(this.#node, next, { allowInMemo: true });
  }
}
