import { Component } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { RouterLink } from '@angular/router';

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
  protected readonly nextPayments = {
    netflix: formatDaysFromToday(NEXT_PAYMENT_IN_DAYS.netflix),
    spotify: formatDaysFromToday(NEXT_PAYMENT_IN_DAYS.spotify),
    microsoft365: formatDaysFromToday(NEXT_PAYMENT_IN_DAYS.microsoft365),
  };
}
