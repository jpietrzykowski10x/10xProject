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
import { STATUS_LABELS } from '../subscription-labels';
import type { Subscription } from '../subscription.types';
import { SubscriptionsService } from '../subscriptions.service';

export interface DeleteSubscriptionDialogData {
  subscription: Subscription;
}

// 'missing': the API answered 404, so the subscription was already gone; either way it is no
// longer on the account. "Anuluj" and Escape close the dialog without a result.
export type DeleteSubscriptionResult = 'deleted' | 'missing';

// Fixed: only one such dialog is open at a time.
const DELETE_SUBSCRIPTION_DESCRIPTION_ID = 'delete-subscription-description';

// Opens the confirmation with its focus on "Anuluj", the first button; after "Anuluj" or Escape
// MatDialog returns the focus to the button that opened it. On the phone it keeps a 16px margin.
export function openDeleteSubscriptionDialog(
  dialog: MatDialog,
  subscription: Subscription,
): MatDialogRef<DeleteSubscriptionDialog, DeleteSubscriptionResult> {
  return dialog.open<
    DeleteSubscriptionDialog,
    DeleteSubscriptionDialogData,
    DeleteSubscriptionResult
  >(DeleteSubscriptionDialog, {
    data: { subscription },
    // A destructive confirmation: an alert dialog, described by the sentence naming the subscription.
    role: 'alertdialog',
    ariaDescribedBy: DELETE_SUBSCRIPTION_DESCRIPTION_ID,
    autoFocus: 'first-tabbable',
    width: '480px',
    maxWidth: 'calc(100vw - 32px)',
  });
}

// The confirmation before a subscription is deleted. "Usuń" sends the DELETE itself; while it is
// in flight the dialog cannot be closed, and a failure keeps it open with a message.
@Component({
  selector: 'app-delete-subscription-dialog',
  imports: [MatButton, MatDialogActions, MatDialogContent, MatDialogTitle],
  templateUrl: './delete-subscription-dialog.html',
  styleUrl: './delete-subscription-dialog.scss',
})
export class DeleteSubscriptionDialog {
  private readonly subscriptions = inject(SubscriptionsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef =
    inject<MatDialogRef<DeleteSubscriptionDialog, DeleteSubscriptionResult>>(MatDialogRef);
  protected readonly subscription =
    inject<DeleteSubscriptionDialogData>(MAT_DIALOG_DATA).subscription;

  protected readonly sending = signal(false);
  protected readonly failed = signal(false);
  protected readonly statusLabels = STATUS_LABELS;

  // Without a result, like Escape (a static mat-dialog-close would return an empty string).
  protected cancel(): void {
    this.dialogRef.close();
  }

  protected confirm(): void {
    // "Usuń" stays focusable while disabled (disabledInteractive), so a click can still get here.
    if (this.sending()) {
      return;
    }
    this.sending.set(true);
    this.failed.set(false);
    this.dialogRef.disableClose = true;
    this.subscriptions
      .delete(this.subscription.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.dialogRef.close('deleted'),
        error: (error: HttpErrorResponse) => {
          if (error.status === 404) {
            this.dialogRef.close('missing');
            return;
          }
          this.sending.set(false);
          this.failed.set(true);
          this.dialogRef.disableClose = false;
        },
      });
  }
}
