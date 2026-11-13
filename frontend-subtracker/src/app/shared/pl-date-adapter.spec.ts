import { TestBed } from '@angular/core/testing';
import { DateAdapter, MAT_DATE_LOCALE } from '@angular/material/core';
import { PlDateAdapter } from './pl-date-adapter';

// The oracle is how the datepicker reads parse(): null is an empty field (no error), an invalid
// Date is text that is not a day (the matDatepickerParse error). A Polish user types d.m.rrrr.
describe('PlDateAdapter', () => {
  let adapter: DateAdapter<Date>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: DateAdapter, useClass: PlDateAdapter },
        { provide: MAT_DATE_LOCALE, useValue: 'pl-PL' },
      ],
    });
    adapter = TestBed.inject<DateAdapter<Date>>(DateAdapter);
  });

  it.each([
    ['05.01.2026', [2026, 1, 5]],
    ['5.1.2026', [2026, 1, 5]],
    ['29.02.2028', [2028, 2, 29]],
  ])('reads %j as the day %j', (value, [year, month, day]) => {
    const date = adapter.parse(value, null);
    expect(date).not.toBeNull();
    expect(date !== null && adapter.isValid(date)).toBe(true);
    expect(date?.getFullYear()).toBe(year);
    expect(date?.getMonth()).toBe(month - 1);
    expect(date?.getDate()).toBe(day);
  });

  it.each(['', '   '])('treats %j as an empty field (null)', (value) => {
    expect(adapter.parse(value, null)).toBeNull();
  });

  it.each(['abc', '31.02.2027', '2026-01-05'])(
    'turns %j into an invalid date, not null',
    (value) => {
      const date = adapter.parse(value, null);
      expect(date).not.toBeNull();
      expect(date !== null && adapter.isValid(date)).toBe(false);
    },
  );

  it('passes a Date through the native adapter', () => {
    const date = adapter.parse(new Date(2026, 0, 5, 12, 30), null);
    expect(date).not.toBeNull();
    expect(date !== null && adapter.isValid(date)).toBe(true);
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(0);
    expect(date?.getDate()).toBe(5);
  });

  it('keeps null as an empty field', () => {
    expect(adapter.parse(null, null)).toBeNull();
  });
});
