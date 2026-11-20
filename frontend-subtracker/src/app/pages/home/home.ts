import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';

// The preview's next-payment dates are today plus a fixed number of days, so the sample never
// shows past dates. The server renders them on the server's date; in the browser the page renders
// again on start-up and shows the visitor's today.
const NEXT_PAYMENT_IN_DAYS = { netflix: 7, spotify: 21, microsoft365: 124 } as const;

function formatDaysFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

@Component({
  selector: 'app-home',
  imports: [MatButton, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  // S-10: the account page navigates here with { accountDeleted: true } after the deletion. Read
  // once, while the navigation that creates the page is still current; on the server and on a plain
  // visit (a reload too) there is no such state, so no notice.
  protected readonly accountDeleted =
    inject(Router).currentNavigation()?.extras.state?.['accountDeleted'] === true;

  protected readonly nextPayments = {
    netflix: formatDaysFromToday(NEXT_PAYMENT_IN_DAYS.netflix),
    spotify: formatDaysFromToday(NEXT_PAYMENT_IN_DAYS.spotify),
    microsoft365: formatDaysFromToday(NEXT_PAYMENT_IN_DAYS.microsoft365),
  };
}
