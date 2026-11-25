import { Injectable } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';

// Polish labels of the paginator (Material's defaults are English). The range reads "1–25 z 80";
// a page past the end shows its would-be range, as Material's own label does.
@Injectable()
export class PlPaginatorIntl extends MatPaginatorIntl {
  override itemsPerPageLabel = 'Na stronie:';
  override nextPageLabel = 'Następna strona';
  override previousPageLabel = 'Poprzednia strona';
  override firstPageLabel = 'Pierwsza strona';
  override lastPageLabel = 'Ostatnia strona';

  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0 || pageSize === 0) {
      return `0 z ${length}`;
    }
    const total = Math.max(length, 0);
    const start = page * pageSize;
    const end = start < total ? Math.min(start + pageSize, total) : start + pageSize;
    return `${start + 1}–${end} z ${total}`;
  };
}
