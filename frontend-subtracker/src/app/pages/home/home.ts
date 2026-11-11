import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  // Placeholder spacing until the start page is rebuilt in ui-foundation phase 4.
  styles: ':host { display: block; max-width: 32rem; padding: 2rem; }',
})
export class Home {}
