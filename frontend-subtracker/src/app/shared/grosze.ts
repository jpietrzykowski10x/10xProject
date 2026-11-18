// An amount in the API's format ("102.82": digits, a dot, two decimals).
const API_AMOUNT = /^(\d+)\.(\d{2})$/;

// The whole grosze of an amount in the API's format ("102.82" → 10282), so sums and shares are
// worked out on integers, never on float decimals; null for anything else.
export function toGrosze(amount: string): number | null {
  const match = API_AMOUNT.exec(amount);
  return match === null ? null : Number(match[1]) * 100 + Number(match[2]);
}

// The whole grosze of a typed amount (42.5 → 4250), so amounts are compared and summed on
// integers; Math.round absorbs the float error of a decimal (0.29 * 100 = 28.999…).
export function numberToGrosze(amount: number): number {
  return Math.round(amount * 100);
}

// An amount in the API's format as a form field shows it, the Polish way ("80.00" → "80,00");
// empty for no amount (null).
export function toAmountText(amount: string | null): string {
  return amount === null ? '' : amount.replace('.', ',');
}
