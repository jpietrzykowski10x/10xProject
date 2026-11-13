import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ServiceUnavailable } from './service-unavailable';

// Only proves the component is created and its template rendered with the providers it has in the
// app (a lost import or provider fails here); it says nothing about behaviour.
describe('ServiceUnavailable', () => {
  it('should create', async () => {
    TestBed.configureTestingModule({
      imports: [ServiceUnavailable],
      providers: [provideRouter([])],
    });
    const fixture = TestBed.createComponent(ServiceUnavailable);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });
});
