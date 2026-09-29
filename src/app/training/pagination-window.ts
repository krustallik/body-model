export type PaginationItem = number | "ellipsis";

/** Keep the first, last, and current-page neighborhood visible without listing every page. */
export function paginationWindow(currentPage: number, totalPages: number): PaginationItem[] {
  if (!Number.isInteger(totalPages) || totalPages < 1) return [];
  const current = Math.min(Math.max(Math.trunc(currentPage) || 1, 1), totalPages);
  const pages = [...new Set([1, current - 1, current, current + 1, totalPages])]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
  const result: PaginationItem[] = [];
  for (const [index, page] of pages.entries()) {
    const previous = pages[index - 1];
    if (previous !== undefined && page - previous === 2) result.push(previous + 1);
    else if (previous !== undefined && page - previous > 2) result.push("ellipsis");
    result.push(page);
  }
  return result;
}
