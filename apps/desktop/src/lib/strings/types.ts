/**
 * Shape of a translation: identical to the Vietnamese source (which is `as const`) except the strings
 * are plain `string` — so a missing key, an extra key or a wrong function parameter in the English
 * version is a type error (`pnpm check`).
 */
export type Translation<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Translation<R>
    : T extends object
      ? { readonly [K in keyof T]: Translation<T[K]> }
      : T;
