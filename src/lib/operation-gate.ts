const activeOperations = new Set<string>();

export function tryAcquireOperation(name: string): (() => void) | null {
  if (activeOperations.has(name)) return null;
  activeOperations.add(name);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeOperations.delete(name);
  };
}
