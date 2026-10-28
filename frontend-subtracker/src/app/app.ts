import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ApiStatus } from './api-status/api-status';

@Component({
  imports: [RouterOutlet, ApiStatus],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {}
