import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppShell } from './app-shell';

// Only proves the component is created and its template rendered with the providers it has in the
// app (a lost import or provider fails here); it says nothing about behaviour. verify() also proves
// that rendering sends no request.
describe('AppShell', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('should create', async () => {
    TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(AppShell);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });
});
