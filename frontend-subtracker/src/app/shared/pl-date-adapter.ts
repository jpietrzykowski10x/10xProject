import { Injectable } from '@angular/core';
import { MAT_NATIVE_DATE_FORMATS, MatDateFormats, NativeDateAdapter } from '@angular/material/core';
import { parseDayMonthYear } from './date-only';

// The native adapter parses typed text with Date.parse, which does not read "05.01.2026". This
// one reads the Polish day.month.year ("05.01.2026", "5.1.2026"). Text it cannot read becomes an
// invalid date, not null: the datepicker treats null as an empty field and would show no error,
// while an invalid date gives the matDatepickerParse error.
@Injectable()
export class PlDateAdapter extends NativeDateAdapter {
  override parse(value: unknown, parseFormat?: unknown): Date | null {
    if (typeof value !== 'string') {
      return super.parse(value, parseFormat);
    }
    if (value.trim() === '') {
      return null;
    }
    return parseDayMonthYear(value) ?? this.invalid();
  }
}

// "05.01.2026" in the field (the native formats would give "5.01.2026"); the calendar keeps the
// native month and accessibility labels, in the MAT_DATE_LOCALE language.
export const PL_DATE_FORMATS: MatDateFormats = {
  ...MAT_NATIVE_DATE_FORMATS,
  display: {
    ...MAT_NATIVE_DATE_FORMATS.display,
    dateInput: { year: 'numeric', month: '2-digit', day: '2-digit' },
  },
};
