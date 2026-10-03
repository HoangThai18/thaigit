/**
 * Kiểu của một bản dịch: cùng hình dạng với bản tiếng Việt (`as const`) nhưng chữ là `string` thường — bản tiếng Anh
 * thiếu khoá, thừa khoá hay sai tham số của hàm đều là lỗi kiểu (`pnpm check`).
 */
export type Translation<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Translation<R>
    : T extends object
      ? { readonly [K in keyof T]: Translation<T[K]> }
      : T;
