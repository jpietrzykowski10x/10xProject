import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Subscriptions } from './subscriptions';

// Only proves the page is created and its template rendered with the providers it has in the app
// (a lost import or provider fails here); it says nothing about behaviour. The page reads the list
// on start, and an empty list mounts the subscription form, which reads the categories.
describe('Subscriptions', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('should create', async () => {
    TestBed.configureTestingModule({
      imports: [Subscriptions],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const httpTesting = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Subscriptions);
    await fixture.whenStable();

    httpTesting.expectOne({ method: 'GET', url: `${environment.apiUrl}/subscriptions` }).flush([]);
    await fixture.whenStable();
    httpTesting.expectOne({ method: 'GET', url: `${environment.apiUrl}/categories` }).flush([]);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });
});
