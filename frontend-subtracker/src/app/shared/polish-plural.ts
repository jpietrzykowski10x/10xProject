// The three Polish forms of a counted noun: "1 subskrypcja", "2 subskrypcje", "5 subskrypcji".
export interface PolishPluralForms {
  one: string;
  few: string;
  many: string;
}

const RULES = new Intl.PluralRules('pl-PL');

// The form of a noun after a whole number `count`: `one` for 1, `few` for 2–4, 22–24, 32–34…
// (but 12–14 take `many`), `many` for everything else, 0 included.
export function polishPlural(count: number, forms: PolishPluralForms): string {
  const category = RULES.select(count);
  if (category === 'one') {
    return forms.one;
  }
  return category === 'few' ? forms.few : forms.many;
}
