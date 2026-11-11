import { Injectable } from '@angular/core';
import { MatDatepickerIntl } from '@angular/material/datepicker';

// Polish labels of the datepicker toggle and calendar (Material's defaults are English).
@Injectable()
export class PlDatepickerIntl extends MatDatepickerIntl {
  override calendarLabel = 'Kalendarz';
  override openCalendarLabel = 'Otwórz kalendarz';
  override closeCalendarLabel = 'Zamknij kalendarz';
  override prevMonthLabel = 'Poprzedni miesiąc';
  override nextMonthLabel = 'Następny miesiąc';
  override prevYearLabel = 'Poprzedni rok';
  override nextYearLabel = 'Następny rok';
  override prevMultiYearLabel = 'Poprzednie 24 lata';
  override nextMultiYearLabel = 'Następne 24 lata';
  override switchToMonthViewLabel = 'Wybierz dzień';
  override switchToMultiYearViewLabel = 'Wybierz miesiąc i rok';
}
