import { Directive, input } from '@angular/core';

// Material types the `let row` of *matCellDef and *matRowDef as `any`. These directives sit on
// the same template and give it the row type of the data source instead:
//   *matCellDef="let row; dataSource: rows()"
//   *matRowDef="let row; columns: cols; dataSource: rows()"
// They do nothing at runtime; the template type checker merges their context guards.

interface RowContext<T> {
  $implicit: T;
}

@Directive({ selector: '[matCellDef][matCellDefDataSource]' })
export class TypedCellDef<T> {
  readonly matCellDefDataSource = input.required<readonly T[]>();

  static ngTemplateContextGuard<T>(_dir: TypedCellDef<T>, _ctx: unknown): _ctx is RowContext<T> {
    return true;
  }
}

@Directive({ selector: '[matRowDef][matRowDefDataSource]' })
export class TypedRowDef<T> {
  readonly matRowDefDataSource = input.required<readonly T[]>();

  static ngTemplateContextGuard<T>(_dir: TypedRowDef<T>, _ctx: unknown): _ctx is RowContext<T> {
    return true;
  }
}
