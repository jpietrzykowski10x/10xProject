import { PlPaginatorIntl } from './pl-paginator-intl';

// The oracle is the plan's label ("1–25 z 80", "0 z 0") counted by hand: the page index starts at
// 0, the range is the first and the last row number on that page.
describe('PlPaginatorIntl', () => {
  it.each([
    ['an empty list', 0, 25, 0, '0 z 0'],
    ['the first full page', 0, 25, 80, '1–25 z 80'], // rows 1..25
    ['a middle page', 1, 25, 80, '26–50 z 80'], // rows 26..50
    ['the last page, not full', 3, 25, 80, '76–80 z 80'], // rows 76..80, 5 of 25
    ['one row', 0, 25, 1, '1–1 z 1'],
    ['exactly one full page', 0, 25, 25, '1–25 z 25'],
    ['a page past the end', 4, 25, 80, '101–125 z 80'], // as Material: the would-be range
  ])('labels %s', (_case, page, pageSize, length, label) => {
    expect(new PlPaginatorIntl().getRangeLabel(page, pageSize, length)).toBe(label);
  });

  it('labels the buttons in Polish', () => {
    const intl = new PlPaginatorIntl();
    expect([
      intl.firstPageLabel,
      intl.previousPageLabel,
      intl.nextPageLabel,
      intl.lastPageLabel,
    ]).toStrictEqual([
      'Pierwsza strona',
      'Poprzednia strona',
      'Następna strona',
      'Ostatnia strona',
    ]);
  });
});
