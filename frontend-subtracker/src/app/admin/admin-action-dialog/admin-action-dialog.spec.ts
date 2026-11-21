import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { environment } from '../../../environments/environment';
import { type AdminActionResult, openAdminActionDialog } from './admin-action-dialog';

const ID = '11111111-1111-4111-8111-111111111111';
const BLOCK_URL = `${environment.apiUrl}/admin/users/${ID}/block`;

@Component({ template: '' })
class Host {
  readonly dialog = inject(MatDialog);
}

async function openBlock() {
  TestBed.configureTestingModule({
    imports: [Host],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(Host);
  const results: (AdminActionResult | undefined)[] = [];
  openAdminActionDialog(fixture.componentInstance.dialog, {
    action: 'block',
    user: { id: ID, email: 'anna@example.com' },
  })
    .afterClosed()
    .subscribe((result) => results.push(result));
  const dialog =
    await TestbedHarnessEnvironment.documentRootLoader(fixture).getHarness(MatDialogHarness);
  const confirm = await dialog.getHarness(MatButtonHarness.with({ text: 'Zablokuj' }));
  return { fixture, dialog, confirm, results, httpTesting: TestBed.inject(HttpTestingController) };
}

afterEach(() => {
  try {
    TestBed.inject(HttpTestingController).verify();
  } finally {
    TestBed.resetTestingModule();
  }
});

// The oracle is the API contract of POST /admin/users/:id/block (backend AdminUsersController):
// 200 is done; 403, 404 and 409 are refusals the page explains; anything else keeps the dialog
// open with a message.
describe('AdminActionDialog', () => {
  it('names the account and closes with "done" after the block', async () => {
    const { fixture, dialog, confirm, results, httpTesting } = await openBlock();
    expect(await dialog.getText()).toContain('anna@example.com');

    await confirm.click();
    httpTesting.expectOne({ method: 'POST', url: BLOCK_URL }).flush({});
    await fixture.whenStable();

    expect(results).toEqual(['done']);
  });

  it.each([
    [403, 'forbidden'],
    [404, 'missing'],
    [409, 'conflict'],
  ])('closes with the refusal of a %i', async (status, expected) => {
    const { fixture, confirm, results, httpTesting } = await openBlock();

    await confirm.click();
    httpTesting
      .expectOne({ method: 'POST', url: BLOCK_URL })
      .flush({ statusCode: status }, { status, statusText: 'Error' });
    await fixture.whenStable();

    expect(results).toEqual([expected]);
  });

  it('stays open with a message after a server error', async () => {
    const { fixture, dialog, confirm, results, httpTesting } = await openBlock();

    await confirm.click();
    httpTesting
      .expectOne({ method: 'POST', url: BLOCK_URL })
      .flush('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
    await fixture.whenStable();

    expect(results).toEqual([]);
    expect(await dialog.getText()).toContain('Nie udało się');
  });
});
