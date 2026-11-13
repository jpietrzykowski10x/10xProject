import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

// Only proves the component is created and its template rendered with the providers it has in the
// app (a lost import or provider fails here); it says nothing about behaviour.
describe('App', () => {
  it('should create', async () => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });
});
