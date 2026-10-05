// happy-dom has no layout: every measurement is 0. For tests that need a viewport "with size" (virtualised lists, resizable columns).
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
