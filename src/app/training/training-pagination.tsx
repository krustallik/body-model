import Link from "next/link";
import type { MouseEvent } from "react";
import { paginationWindow } from "./pagination-window";
import styles from "./training.module.css";

type TrainingPaginationProps = {
  currentPage: number;
  totalPages: number;
  hrefForPage: (page: number) => string;
  label: string;
  uk: boolean;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

export function TrainingPagination({
  currentPage,
  totalPages,
  hrefForPage,
  label,
  uk,
  onNavigate,
}: TrainingPaginationProps) {
  const items = paginationWindow(currentPage, totalPages);
  const previousLabel = uk ? "Попередня сторінка" : "Previous page";
  const nextLabel = uk ? "Наступна сторінка" : "Next page";

  return (
    <nav className={styles.pagination} aria-label={label}>
      <span className={styles.paginationSummary} aria-live="polite">
        {uk ? `Сторінка ${currentPage} з ${totalPages}` : `Page ${currentPage} of ${totalPages}`}
      </span>
      <div className={styles.paginationControls}>
        {currentPage > 1 ? (
          <Link className={`${styles.pageButton} ${styles.pageButtonArrow}`} href={hrefForPage(currentPage - 1)} onClick={onNavigate} aria-label={previousLabel}>
            ‹
          </Link>
        ) : (
          <span className={`${styles.pageButton} ${styles.pageButtonArrow}`} aria-label={previousLabel} aria-disabled="true">
            ‹
          </span>
        )}
        {items.map((item, index) => item === "ellipsis" ? (
          <span className={styles.paginationEllipsis} aria-hidden="true" key={`ellipsis-${index}`}>…</span>
        ) : (
          <Link
            className={item === currentPage ? `${styles.pageButton} ${styles.pageButtonCurrent}` : `${styles.pageButton} ${styles.pageNumber}`}
            href={hrefForPage(item)}
            onClick={onNavigate}
            aria-label={uk ? `Сторінка ${item}` : `Page ${item}`}
            aria-current={item === currentPage ? "page" : undefined}
            key={item}
          >
            {item}
          </Link>
        ))}
        {currentPage < totalPages ? (
          <Link className={`${styles.pageButton} ${styles.pageButtonArrow}`} href={hrefForPage(currentPage + 1)} onClick={onNavigate} aria-label={nextLabel}>
            ›
          </Link>
        ) : (
          <span className={`${styles.pageButton} ${styles.pageButtonArrow}`} aria-label={nextLabel} aria-disabled="true">
            ›
          </span>
        )}
      </div>
    </nav>
  );
}
