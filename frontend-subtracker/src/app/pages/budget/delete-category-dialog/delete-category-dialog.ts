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
import { ErrorReporter } from '../../../shared/error-reporter';
import type { Category } from '../../../subscriptions/subscription.types';
import { SubscriptionsService } from '../../../subscriptions/subscriptions.service';

export interface DeleteCategoryDialogData {
  category: Category;
}

// 'missing': the API answered 404, so the category was already gone; either way it is no longer
// on the account. "Anuluj" and Escape close the dialog without a result, also after the API refused
// a category with subscriptions (409).
export type DeleteCategoryResult = 'deleted' | 'missing';

// Fixed: only one such dialog is open at a time.
const DELETE_CATEGORY_DESCRIPTION_ID = 'delete-category-description';

// Opens the confirmation with its focus on "Anuluj", the first button; after "Anuluj" or Escape
// MatDialog returns the focus to the button that opened it. On the phone it keeps a 16px margin.
// Only for an own category (the API deletes no default one).
export function openDeleteCategoryDialog(
  dialog: MatDialog,
  category: Category,
): MatDialogRef<DeleteCategoryDialog, DeleteCategoryResult> {
  return dialog.open<DeleteCategoryDialog, DeleteCategoryDialogData, DeleteCategoryResult>(
    DeleteCategoryDialog,
    {
      data: { category },
      // A destructive confirmation: an alert dialog, described by the sentence on what goes with it.
      role: 'alertdialog',
      ariaDescribedBy: DELETE_CATEGORY_DESCRIPTION_ID,
      autoFocus: 'first-tabbable',
      width: '480px',
      maxWidth: 'calc(100vw - 32px)',
    },
  );
}

// The confirmation before an own category is deleted. "Usuń" sends the DELETE itself; while it is
// in flight the dialog cannot be closed. A category with subscriptions (409) stays, with a message
// on what to do first; any other failure keeps the dialog open with a message.
@Component({
  selector: 'app-delete-category-dialog',
  imports: [MatButton, MatDialogActions, MatDialogContent, MatDialogTitle],
  templateUrl: './delete-category-dialog.html',
  styleUrl: './delete-category-dialog.scss',
})
export class DeleteCategoryDialog {
  private readonly subscriptions = inject(SubscriptionsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reporter = inject(ErrorReporter);
  private readonly dialogRef =
    inject<MatDialogRef<DeleteCategoryDialog, DeleteCategoryResult>>(MatDialogRef);
  protected readonly category = inject<DeleteCategoryDialogData>(MAT_DIALOG_DATA).category;

  protected readonly sending = signal(false);
  protected readonly failed = signal(false);
  // 409: the category has subscriptions; "Usuń" stays off, a second try would be refused too.
  protected readonly hasSubscriptions = signal(false);

  // Without a result, like Escape (a static mat-dialog-close would return an empty string).
  protected cancel(): void {
    this.dialogRef.close();
  }

  protected confirm(): void {
    // "Usuń" stays focusable while disabled (disabledInteractive), so a click can still get here.
    if (this.sending() || this.hasSubscriptions()) {
      return;
    }
    this.sending.set(true);
    this.failed.set(false);
    this.dialogRef.disableClose = true;
    this.subscriptions
      .deleteCategory(this.category.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.dialogRef.close('deleted'),
        error: (error: HttpErrorResponse) => {
          if (error.status === 404) {
            this.dialogRef.close('missing');
            return;
          }
          this.sending.set(false);
          this.dialogRef.disableClose = false;
          if (error.status === 409) {
            this.hasSubscriptions.set(true);
          } else {
            this.reporter.report('DeleteCategoryDialog', error);
            this.failed.set(true);
          }
        },
      });
  }
}
