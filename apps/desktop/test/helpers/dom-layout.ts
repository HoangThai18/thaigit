// happy-dom không có layout: mọi kích thước là 0. Cho các test cần khung nhìn "có kích thước" (danh sách ảo hoá, cột đổi rộng).
export function stubLayout(size: { width: number; height: number }): () => void {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const define = (name: string, value: number): void => {
    originals.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  };
  define('clientWidth', size.width);
  define('clientHeight', size.height);
  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, name);
    }
  };
}
