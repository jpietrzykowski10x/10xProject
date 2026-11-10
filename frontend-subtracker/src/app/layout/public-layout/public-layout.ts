import { Component, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';

// No view encapsulation: the column styles the aside content pages project into it, which
// emulated encapsulation cannot reach. Every selector is scoped under the host element instead.
@Component({
  selector: 'app-public-layout',
  imports: [RouterLink],
  templateUrl: './public-layout.html',
  styleUrl: './public-layout.scss',
  encapsulation: ViewEncapsulation.None,
})
export class PublicLayout {}
