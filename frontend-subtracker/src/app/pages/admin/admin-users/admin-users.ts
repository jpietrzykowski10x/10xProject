import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatOption } from '@angular/material/core';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSelect } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Subscription as RxSubscription } from 'rxjs';
import { accountStatusLabel, ADMIN_ROLE_LABELS } from '../../../admin/admin-labels';
import { AdminService } from '../../../admin/admin.service';
import {
  ADMIN_SEARCH_LIMIT,
  ADMIN_SEARCH_MIN_LENGTH,
  type AdminStatusFilter,
  type AdminUserSummary,
} from '../../../admin/admin.types';
import { AppShell } from '../../../layout/app-shell/app-shell';
import { FORM_FIELD_DEFAULTS } from '../../../shared/form-field-defaults';

type SearchState =
  | { kind: 'idle' }
  | { kind: 'too-short' }
  | { kind: 'loading' }
  | { kind: 'ready'; users: AdminUserSummary[] }
  | { kind: 'forbidden' }
  | { kind: 'error' };

// S-09: the administrator's search of accounts by a fragment of the address, optionally only the
// active or the blocked ones. The query lives in the address (?q=&status=, no status for `all`),
// so going back from an account shows the same results; each account link carries it along, so
// the account page can lead back to the same list. The shell does not show the administrator's own totals here.
@Component({
  selector: 'app-admin-users',
  providers: [FORM_FIELD_DEFAULTS],
  imports: [
    AppShell,
    DatePipe,
    MatButton,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    MatOption,
    MatSelect,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './admin-users.html',
  styleUrl: './admin-users.scss',
})
export class AdminUsers implements OnInit {
  private readonly admin = inject(AdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private request?: RxSubscription;

  protected readonly minLength = ADMIN_SEARCH_MIN_LENGTH;
  protected readonly limit = ADMIN_SEARCH_LIMIT;
  protected readonly roleLabels = ADMIN_ROLE_LABELS;
  protected readonly statusLabel = accountStatusLabel;
  protected readonly form = inject(NonNullableFormBuilder).group({
    q: [''],
    status: ['all' as AdminStatusFilter],
  });
  protected readonly statusOptions: readonly { value: AdminStatusFilter; label: string }[] = [
    { value: 'all', label: 'Wszystkie' },
    { value: 'active', label: 'Aktywny' },
    { value: 'blocked', label: 'Zablokowany' },
  ];
  protected readonly state = signal<SearchState>({ kind: 'idle' });
  // The list's query, handed to each account link so its page can come back to this list.
  protected readonly listQuery = signal<Record<string, string>>({});

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const q = params.get('q') ?? '';
      const status = toStatusFilter(params.get('status'));
      this.form.setValue({ q, status });
      this.listQuery.set(listQueryParams(q, status));
      this.search(q, status);
    });
  }

  // Puts the query into the address; the subscription above runs the search.
  protected submit(): void {
    const { q, status } = this.form.getRawValue();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: listQueryParams(q.trim(), status),
    });
  }

  private search(q: string, status: AdminStatusFilter): void {
    this.request?.unsubscribe();
    if (q === '' && status !== 'blocked') {
      this.state.set({ kind: 'idle' });
      return;
    }
    // The API refuses a shorter fragment (400) unless only the blocked accounts are listed.
    if (q !== '' && q.length < ADMIN_SEARCH_MIN_LENGTH) {
      this.state.set({ kind: 'too-short' });
      return;
    }
    this.state.set({ kind: 'loading' });
    this.request = this.admin
      .search(q, status)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (users) => this.state.set({ kind: 'ready', users }),
        error: (error: HttpErrorResponse) => {
          if (error.status === 400) {
            this.state.set({ kind: 'too-short' });
          } else if (error.status === 403) {
            this.state.set({ kind: 'forbidden' });
          } else {
            this.state.set({ kind: 'error' });
          }
        },
      });
  }
}

// An unknown or missing `status` in the address counts as `all`.
function toStatusFilter(value: string | null): AdminStatusFilter {
  return value === 'active' || value === 'blocked' ? value : 'all';
}

// The address of a list: no empty `q`, no `status` for `all`.
function listQueryParams(q: string, status: AdminStatusFilter): Record<string, string> {
  const params: Record<string, string> = {};
  if (q !== '') {
    params['q'] = q;
  }
  if (status !== 'all') {
    params['status'] = status;
  }
  return params;
}
