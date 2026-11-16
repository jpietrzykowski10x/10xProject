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
import { DateOnlyPipe } from '../../shared/date-only.pipe';
import { referenceDate, STATUS_LABELS } from '../subscription-labels';
import type { Subscription } from '../subscription.types';
import { SubscriptionsService } from '../subscriptions.service';

export interface CancelSubscriptionDialogData {
  subscription: Subscription;
}

// 'missing': the API answered 404, the subscription is gone. 'conflict': 409, its status changed
// in the meantime (e.g. in another tab), so it can no longer be cancelled. "Wróć" and Escape close
// the dialog without a result.
export type CancelSubscriptionResult = 'cancelled' | 'missing' | 'conflict';

// Fixed: only one such dialog is open at a time.
const CANCEL_SUBSCRIPTION_DESCRIPTION_ID = 'cancel-subscription-description';

// Opens the confirmation with its focus on "Wróć", the first button; after "Wróć" or Escape
// MatDialog returns the focus to the button that opened it. On the phone it keeps a 16px margin.
// Only for an active or trial subscription (the only statuses the API cancels).
export function openCancelSubscriptionDialog(
  dialog: MatDialog,
  subscription: Subscription,
): MatDialogRef<CancelSubscriptionDialog, CancelSubscriptionResult> {
  return dialog.open<
    CancelSubscriptionDialog,
    CancelSubscriptionDialogData,
    CancelSubscriptionResult
  >(CancelSubscriptionDialog, {
    data: { subscription },
    // A confirmation of a change the user may regret: an alert dialog, described by its sentence.
    role: 'alertdialog',
    ariaDescribedBy: CANCEL_SUBSCRIPTION_DESCRIPTION_ID,
    autoFocus: 'first-tabbable',
    width: '480px',
    maxWidth: 'calc(100vw - 32px)',
  });
}

// The confirmation before a subscription is cancelled. "Anuluj subskrypcję" sends the POST itself;
// while it is in flight the dialog cannot be closed, and a failure keeps it open with a message.
@Component({
  selector: 'app-cancel-subscription-dialog',
  imports: [DateOnlyPipe, MatButton, MatDialogActions, MatDialogContent, MatDialogTitle],
  templateUrl: './cancel-subscription-dialog.html',
  styleUrl: './cancel-subscription-dialog.scss',
})
export class CancelSubscriptionDialog {
  private readonly subscriptions = inject(SubscriptionsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef =
    inject<MatDialogRef<CancelSubscriptionDialog, CancelSubscriptionResult>>(MatDialogRef);
  protected readonly subscription =
    inject<CancelSubscriptionDialogData>(MAT_DIALOG_DATA).subscription;

  // The end of the trial for a trial, otherwise the next billing date: the day after which the
  // subscription is cancelled and leaves the totals.
  protected readonly endDate = referenceDate(this.subscription);

  protected readonly sending = signal(false);
  protected readonly failed = signal(false);
  protected readonly statusLabels = STATUS_LABELS;

  // Without a result, like Escape (a static mat-dialog-close would return an empty string).
  protected back(): void {
    this.dialogRef.close();
  }

  protected confirm(): void {
    // The button stays focusable while disabled (disabledInteractive), so a click can still get here.
    if (this.sending()) {
      return;
    }
    this.sending.set(true);
    this.failed.set(false);
    this.dialogRef.disableClose = true;
    this.subscriptions
      .cancel(this.subscription.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.dialogRef.close('cancelled'),
        error: (error: HttpErrorResponse) => {
          if (error.status === 404) {
            this.dialogRef.close('missing');
            return;
          }
          if (error.status === 409) {
            this.dialogRef.close('conflict');
            return;
          }
          this.sending.set(false);
          this.failed.set(true);
          this.dialogRef.disableClose = false;
        },
      });
  }
}
