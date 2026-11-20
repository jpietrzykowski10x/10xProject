import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { Router } from '@angular/router';
import { AuthService } from '../../../auth/auth.service';
import { FORM_FIELD_DEFAULTS } from '../../../shared/form-field-defaults';
import { CostTotalsStore } from '../../../subscriptions/cost-totals.store';

export interface DeleteAccountDialogData {
  // The signed-in account's address, as GET /auth/session returned it (already normalized).
  email: string;
}

// true: the account is deleted and the session cookie cleared. "Anuluj" and Escape close the
// dialog without a result; a 401 closes it with false (the page has nothing left to do then).
export type DeleteAccountResult = boolean;

// Fixed: only one such dialog is open at a time.
const DELETE_ACCOUNT_DESCRIPTION_ID = 'delete-account-description';

// The comparison the API makes (backend normalizeEmail): trimmed and lower-cased on both sides.
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

// 400: the API compared the address and it differs (e.g. the account's address changed meanwhile).
const MISMATCH_MESSAGE = 'Adres nie zgadza się z adresem konta.';
const UNAVAILABLE_MESSAGE =
  'Serwis jest chwilowo niedostępny. Konto nie zostało usunięte, spróbuj ponownie za chwilę.';

// Opens the confirmation with its focus on "Anuluj", not on the address field that comes first:
// a destructive dialog starts on the safe action. After "Anuluj" or Escape MatDialog returns the
// focus to the button that opened it. On the phone it keeps a 16px margin.
export function openDeleteAccountDialog(
  dialog: MatDialog,
  email: string,
): MatDialogRef<DeleteAccountDialog, DeleteAccountResult> {
  return dialog.open<DeleteAccountDialog, DeleteAccountDialogData, DeleteAccountResult>(
    DeleteAccountDialog,
    {
      data: { email },
      role: 'alertdialog',
      ariaDescribedBy: DELETE_ACCOUNT_DESCRIPTION_ID,
      autoFocus: '.dialog__cancel',
      width: '480px',
      maxWidth: 'calc(100vw - 32px)',
    },
  );
}

// S-10: the confirmation before the account is deleted. "Usuń konto" is on only when the typed
// address is the account's own; it sends the request itself, the dialog cannot be closed while it
// is in flight, and a failure keeps it open with a message.
@Component({
  selector: 'app-delete-account-dialog',
  providers: [FORM_FIELD_DEFAULTS],
  imports: [
    MatButton,
    MatDialogActions,
    MatDialogContent,
    MatDialogTitle,
    MatFormField,
    MatInput,
    MatLabel,
    ReactiveFormsModule,
  ],
  templateUrl: './delete-account-dialog.html',
  styleUrl: './delete-account-dialog.scss',
})
export class DeleteAccountDialog {
  private readonly auth = inject(AuthService);
  private readonly totals = inject(CostTotalsStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef =
    inject<MatDialogRef<DeleteAccountDialog, DeleteAccountResult>>(MatDialogRef);
  private readonly accountEmail = normalizeEmail(
    inject<DeleteAccountDialogData>(MAT_DIALOG_DATA).email,
  );

  protected readonly form = inject(NonNullableFormBuilder).group({ email: '' });
  private readonly confirmation = this.form.controls.email;
  private readonly typed = toSignal(this.confirmation.valueChanges, {
    initialValue: this.confirmation.value,
  });
  protected readonly matches = computed(() => normalizeEmail(this.typed()) === this.accountEmail);
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);

  // Without a result, like Escape (a static mat-dialog-close would return an empty string).
  protected cancel(): void {
    this.dialogRef.close();
  }

  protected confirm(): void {
    // "Usuń konto" stays focusable while disabled (disabledInteractive), and Enter in the field
    // submits the form, so both can get here with a wrong address or during a request.
    if (this.sending() || !this.matches()) {
      return;
    }
    this.sending.set(true);
    this.error.set(null);
    this.dialogRef.disableClose = true;
    this.auth
      .deleteAccount(this.confirmation.value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.dialogRef.close(true),
        error: (error: HttpErrorResponse) => {
          if (error.status === 401) {
            // The session ended meanwhile. The 401 interceptor skips /auth/, so the dialog does
            // what it would do: drop the cost totals and go to the sign-in page.
            this.totals.clear();
            this.dialogRef.close(false);
            void this.router.navigateByUrl('/sign-in');
            return;
          }
          this.sending.set(false);
          this.dialogRef.disableClose = false;
          this.error.set(error.status === 400 ? MISMATCH_MESSAGE : UNAVAILABLE_MESSAGE);
        },
      });
  }
}
