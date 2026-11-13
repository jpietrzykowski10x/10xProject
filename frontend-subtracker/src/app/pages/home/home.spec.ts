import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Home } from './home';

// Only proves the component is created and its template rendered with the providers it has in the
// app (a lost import or provider fails here); it says nothing about behaviour.
describe('Home', () => {
  it('should create', async () => {
    TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideRouter([])],
    });
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });
});
