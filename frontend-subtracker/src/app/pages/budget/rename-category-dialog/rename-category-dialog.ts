import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { ErrorReporter } from '../../../shared/error-reporter';
import { FORM_FIELD_DEFAULTS } from '../../../shared/form-field-defaults';
import { trimmedRequired } from '../../../shared/validation/trimmed-required';
import { CATEGORY_NAME_MAX_LENGTH, type Category } from '../../../subscriptions/subscription.types';
import { SubscriptionsService } from '../../../subscriptions/subscriptions.service';

export interface RenameCategoryDialogData {
  category: Category;
}

// 'missing': the API answered 404, so the category was already gone (e.g. deleted in another
// tab). "Anuluj" and Escape close the dialog without a result.
export type RenameCategoryResult = 'renamed' | 'missing';

// Opens the dialog with its focus in the name field, the first tabbable element; after "Anuluj" or
// Escape MatDialog returns the focus to the button that opened it. On the phone it keeps a 16px
// margin. Only for an own category (the API renames no default one).
export function openRenameCategoryDialog(
  dialog: MatDialog,
  category: Category,
): MatDialogRef<RenameCategoryDialog, RenameCategoryResult> {
  return dialog.open<RenameCategoryDialog, RenameCategoryDialogData, RenameCategoryResult>(
    RenameCategoryDialog,
    {
      data: { category },
      autoFocus: 'first-tabbable',
      width: '480px',
      maxWidth: 'calc(100vw - 32px)',
    },
  );
}

// A new name for an own category. "Zapisz" sends the PATCH itself; while it is in flight the dialog
// cannot be closed. A name taken by another category is an error of the field, any other failure
// keeps the dialog open with a message.
@Component({
  selector: 'app-rename-category-dialog',
  providers: [FORM_FIELD_DEFAULTS],
  imports: [
    MatButton,
    MatDialogActions,
    MatDialogContent,
    MatDialogTitle,
    MatError,
    MatFormField,
    MatInput,
    MatLabel,
    ReactiveFormsModule,
  ],
  templateUrl: './rename-category-dialog.html',
  styleUrl: './rename-category-dialog.scss',
})
export class RenameCategoryDialog {
  private readonly subscriptions = inject(SubscriptionsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reporter = inject(ErrorReporter);
  private readonly dialogRef =
    inject<MatDialogRef<RenameCategoryDialog, RenameCategoryResult>>(MatDialogRef);
  protected readonly category = inject<RenameCategoryDialogData>(MAT_DIALOG_DATA).category;

  // A group of one field, so the form's ngSubmit (Enter in the field) reaches save().
  protected readonly form = inject(NonNullableFormBuilder).group({
    name: [this.category.name, trimmedRequired],
  });
  protected readonly name = this.form.controls.name;
  private readonly typedName = signal(this.category.name);
  // Off for an empty name and for the current one (the API would change nothing); a change of the
  // letter case alone is a new name.
  protected readonly canSave = computed(() => {
    const name = this.typedName().trim();
    return name !== '' && name !== this.category.name;
  });
  protected readonly maxLength = CATEGORY_NAME_MAX_LENGTH;
  protected readonly sending = signal(false);
  protected readonly failed = signal(false);

  constructor() {
    this.name.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => this.typedName.set(value));
  }

  // Without a result, like Escape (a static mat-dialog-close would return an empty string).
  protected cancel(): void {
    this.dialogRef.close();
  }

  protected save(): void {
    // "Zapisz" stays focusable while disabled (disabledInteractive), and Enter in the field submits
    // the form, so both can get here.
    if (this.sending() || !this.canSave()) {
      return;
    }
    this.sending.set(true);
    this.failed.set(false);
    this.dialogRef.disableClose = true;
    this.subscriptions
      .renameCategory(this.category.id, this.name.value.trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.dialogRef.close('renamed'),
        error: (error: HttpErrorResponse) => {
          if (error.status === 404) {
            this.dialogRef.close('missing');
            return;
          }
          this.sending.set(false);
          this.dialogRef.disableClose = false;
          if (error.status === 409) {
            // Cleared by the validators with the next keystroke.
            this.name.setErrors({ conflict: true });
            this.name.markAsTouched();
          } else {
            this.reporter.report('RenameCategoryDialog', error);
            this.failed.set(true);
          }
        },
      });
  }
}
