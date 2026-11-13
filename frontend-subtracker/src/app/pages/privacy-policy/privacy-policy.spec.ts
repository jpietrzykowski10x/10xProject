import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PrivacyPolicy } from './privacy-policy';

// Only proves the component is created and its template rendered with the providers it has in the
// app (a lost import or provider fails here); it says nothing about behaviour.
describe('PrivacyPolicy', () => {
  it('should create', async () => {
    TestBed.configureTestingModule({
      imports: [PrivacyPolicy],
      providers: [provideRouter([])],
    });
    const fixture = TestBed.createComponent(PrivacyPolicy);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });
});
