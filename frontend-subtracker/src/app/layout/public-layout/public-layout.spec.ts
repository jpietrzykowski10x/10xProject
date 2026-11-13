import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PublicLayout } from './public-layout';

// Only proves the component is created and its template rendered with the providers it has in the
// app (a lost import or provider fails here); it says nothing about behaviour.
describe('PublicLayout', () => {
  it('should create', async () => {
    TestBed.configureTestingModule({
      imports: [PublicLayout],
      providers: [provideRouter([])],
    });
    const fixture = TestBed.createComponent(PublicLayout);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });
});
