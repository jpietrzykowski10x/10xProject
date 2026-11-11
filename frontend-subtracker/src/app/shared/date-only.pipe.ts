import { formatDate } from '@angular/common';
import { inject, LOCALE_ID, Pipe, PipeTransform } from '@angular/core';
import { parseDateOnly } from './date-only';

// Formats a calendar day from the API ("2026-11-15") as "15.11.2026", without a time-zone shift.
@Pipe({ name: 'dateOnly' })
export class DateOnlyPipe implements PipeTransform {
  private readonly locale = inject(LOCALE_ID);

  transform(value: string): string {
    const day = parseDateOnly(value);
    return day === null ? value : formatDate(day, 'dd.MM.yyyy', this.locale);
  }
}
