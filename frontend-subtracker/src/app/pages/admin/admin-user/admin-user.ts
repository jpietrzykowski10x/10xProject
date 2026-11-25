import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Subscription as RxSubscription } from 'rxjs';
import {
  type AdminAction,
  type AdminActionDone,
  type AdminActionResult,
  openAdminActionDialog,
} from '../../../admin/admin-action-dialog/admin-action-dialog';
import { accountStatusLabel, ADMIN_ROLE_LABELS } from '../../../admin/admin-labels';
import { AdminService } from '../../../admin/admin.service';
import type { AdminUserDetail } from '../../../admin/admin.types';
import { AppShell } from '../../../layout/app-shell/app-shell';
import { ErrorReporter } from '../../../shared/error-reporter';
import { CostTotals } from '../../../subscriptions/cost-totals/cost-totals';
import { SubscriptionTable } from '../../subscriptions/subscription-table/subscription-table';

type DetailState =
  | { kind: 'loading' }
  | { kind: 'ready'; detail: AdminUserDetail }
  | { kind: 'forbidden' }
  | { kind: 'missing' }
  | { kind: 'error' };

const DONE_MESSAGES: Record<AdminAction, string> = {
  block: 'Konto zostało zablokowane.',
  unblock: 'Konto zostało odblokowane.',
  'reset-sessions': 'Konto zostało wylogowane na wszystkich urządzeniach.',
};

const REFUSED_MESSAGES: Record<Exclude<AdminActionResult, AdminActionDone>, string> = {
  forbidden: 'Brak uprawnień do zarządzania tym kontem.',
  missing: 'Nie ma takiego konta.',
  conflict: 'Stan konta zmienił się w międzyczasie. Odświeżyliśmy widok.',
};

// S-09: one account as the administrator sees it, read-only: the profile, the account's own cost
// totals, its subscriptions and its budget limits. Block, unblock and "sign out everywhere" appear
// only when the administrator outranks the account (canManage); after each the view is read again.
// The shell shows neither the administrator's totals nor loads them.
@Component({
  selector: 'app-admin-user',
  imports: [AppShell, CostTotals, CurrencyPipe, DatePipe, MatButton, RouterLink, SubscriptionTable],
  templateUrl: './admin-user.html',
  styleUrl: './admin-user.scss',
})
export class AdminUser implements OnInit {
  private readonly admin = inject(AdminService);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reporter = inject(ErrorReporter);
  private request?: RxSubscription;
  private id = '';

  protected readonly roleLabels = ADMIN_ROLE_LABELS;
  protected readonly statusLabel = accountStatusLabel;
  protected readonly state = signal<DetailState>({ kind: 'loading' });
  protected readonly statusMessage = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.id = params.get('id') ?? '';
      this.statusMessage.set(null);
      this.actionError.set(null);
      this.state.set({ kind: 'loading' });
      this.load();
    });
  }

  protected act(action: AdminAction, detail: AdminUserDetail): void {
    this.statusMessage.set(null);
    this.actionError.set(null);
    openAdminActionDialog(this.dialog, { action, user: detail.user })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result === undefined) {
          return;
        }
        if (typeof result === 'object') {
          // The change does not touch subscriptions, totals or the budget: only the profile is
          // updated, from the answer, so the action leaves no extra VIEW in the audit.
          const done = result.user;
          this.state.update((current) =>
            current.kind === 'ready'
              ? {
                  kind: 'ready',
                  detail: { ...current.detail, user: { ...current.detail.user, ...done } },
                }
              : current,
          );
          this.statusMessage.set(DONE_MESSAGES[action]);
          return;
        }
        this.actionError.set(REFUSED_MESSAGES[result]);
        // 403 changes nothing; after 404 or 409 the account changed meanwhile, so read it again.
        if (result !== 'forbidden') {
          this.load();
        }
      });
  }

  // A 400 comes from an id that is not a UUID: to the administrator that is no such account too.
  protected load(): void {
    this.request?.unsubscribe();
    this.request = this.admin
      .user(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => this.state.set({ kind: 'ready', detail }),
        error: (error: HttpErrorResponse) => {
          if (error.status === 403) {
            this.state.set({ kind: 'forbidden' });
          } else if (error.status === 404 || error.status === 400) {
            this.state.set({ kind: 'missing' });
          } else {
            this.reporter.report('AdminUser', error);
            this.state.set({ kind: 'error' });
          }
        },
      });
  }

  protected limit(value: string | null): number | null {
    return value === null ? null : Number(value);
  }
}
