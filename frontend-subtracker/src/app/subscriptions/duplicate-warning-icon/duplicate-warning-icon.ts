import { Component, input } from '@angular/core';

// S-07: a triangle with an exclamation mark in the colour of a duplicate warning, orange when the
// threshold is reached and red when it is exceeded. Used in the cost totals and on /dashboard.
// The colour comes from --st-alert-warning / --st-alert-danger; a navy surface remaps them to the
// -on-navy pair (cost-totals.scss). With a `label` the icon is an image with that name; without
// one it is decorative and the text next to it says what happened, so colour is never the only
// information.
@Component({
  selector: 'app-duplicate-warning-icon',
  templateUrl: './duplicate-warning-icon.html',
  styleUrl: './duplicate-warning-icon.scss',
  host: { '[attr.data-warning]': 'level()' },
})
export class DuplicateWarningIcon {
  readonly level = input.required<'reached' | 'exceeded'>();
  // The accessible name ("1 kategoria przekroczyła próg"); null for a decorative icon.
  readonly label = input<string | null>(null);
}
