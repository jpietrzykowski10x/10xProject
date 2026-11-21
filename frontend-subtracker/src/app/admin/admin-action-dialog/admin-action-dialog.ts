import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import type { Observable } from 'rxjs';
import { AdminService } from '../admin.service';
import type { AdminUserSummary } from '../admin.types';

export type AdminAction = 'block' | 'unblock' | 'reset-sessions';

export interface AdminActionDialogData {
  action: AdminAction;
  user: Pick<AdminUserSummary, 'id' | 'email'>;
}

// 'done': the API made the change. 'forbidden' (403), 'missing' (404) and 'conflict' (409): the
// API refused it because the account changed meanwhile; the page reads it again and says why.
// "Anuluj" and Escape close the dialog without a result.
export type AdminActionResult = 'done' | 'forbidden' | 'missing' | 'conflict';

interface ActionTexts {
  title: string;
  description: string;
  confirm: string;
}

const TEXTS: Record<AdminAction, ActionTexts> = {
  block: {
    title: 'Zablokować konto?',
    description:
      'Właściciel konta {email} zostanie wylogowany na wszystkich urządzeniach i nie zaloguje się, dopóki konto nie zostanie odblokowane. Dostanie o tym wiadomość e-mail.',
    confirm: 'Zablokuj',
  },
  unblock: {
    title: 'Odblokować konto?',
    description:
      'Właściciel konta {email} znów będzie mógł się zalogować. Dostanie o tym wiadomość e-mail.',
    confirm: 'Odblokuj',
  },
  'reset-sessions': {
    title: 'Wylogować wszędzie?',
    description:
      'Konto {email} zostanie wylogowane na wszystkich urządzeniach. Właściciel może zalogować się ponownie.',
    confirm: 'Wyloguj wszędzie',
  },
};

const ERROR_RESULTS: Partial<Record<number, AdminActionResult>> = {
  403: 'forbidden',
  404: 'missing',
  409: 'conflict',
};

// Fixed: only one such dialog is open at a time.
const ADMIN_ACTION_DESCRIPTION_ID = 'admin-action-description';

// Opens the confirmation with its focus on "Anuluj", like the subscription delete dialog.
export function openAdminActionDialog(
  dialog: MatDialog,
  data: AdminActionDialogData,
): MatDialogRef<AdminActionDialog, AdminActionResult> {
  return dialog.open<AdminActionDialog, AdminActionDialogData, AdminActionResult>(
    AdminActionDialog,
    {
      data,
      role: 'alertdialog',
      ariaDescribedBy: ADMIN_ACTION_DESCRIPTION_ID,
      autoFocus: 'first-tabbable',
      width: '480px',
      maxWidth: 'calc(100vw - 32px)',
    },
  );
}

// S-09: the confirmation of an administrator's action on another account. The confirm button
// sends the request itself; while it is in flight the dialog cannot be closed, and a failure
// other than a refusal keeps it open with a message.
@Component({
  selector: 'app-admin-action-dialog',
  imports: [MatButton, MatDialogActions, MatDialogContent, MatDialogTitle],
  templateUrl: './admin-action-dialog.html',
  styleUrl: './admin-action-dialog.scss',
})
export class AdminActionDialog {
  private readonly admin = inject(AdminService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef =
    inject<MatDialogRef<AdminActionDialog, AdminActionResult>>(MatDialogRef);
  private readonly data = inject<AdminActionDialogData>(MAT_DIALOG_DATA);

  protected readonly descriptionId = ADMIN_ACTION_DESCRIPTION_ID;
  protected readonly texts = TEXTS[this.data.action];
  protected readonly description = this.texts.description.replace('{email}', this.data.user.email);
  protected readonly sending = signal(false);
  protected readonly failed = signal(false);

  // Without a result, like Escape (a static mat-dialog-close would return an empty string).
  protected cancel(): void {
    this.dialogRef.close();
  }

  protected confirm(): void {
    if (this.sending()) {
      return;
    }
    this.sending.set(true);
    this.failed.set(false);
    this.dialogRef.disableClose = true;
    this.request()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.dialogRef.close('done'),
        error: (error: HttpErrorResponse) => {
          const result = ERROR_RESULTS[error.status];
          if (result !== undefined) {
            this.dialogRef.close(result);
            return;
          }
          this.sending.set(false);
          this.failed.set(true);
          this.dialogRef.disableClose = false;
        },
      });
  }

  private request(): Observable<AdminUserSummary> {
    const id = this.data.user.id;
    switch (this.data.action) {
      case 'block':
        return this.admin.block(id);
      case 'unblock':
        return this.admin.unblock(id);
      case 'reset-sessions':
        return this.admin.resetSessions(id);
    }
  }
}
