import { TestBed } from '@angular/core/testing';
import { SubscriptionTable } from './subscription-table';

// Only proves the table is created and its template rendered with its required input; it says
// nothing about the rows.
describe('SubscriptionTable', () => {
  it('should create', async () => {
    const fixture = TestBed.createComponent(SubscriptionTable);
    fixture.componentRef.setInput('subscriptions', []);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });
});
