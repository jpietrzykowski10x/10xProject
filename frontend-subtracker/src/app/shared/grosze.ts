// An amount in the API's format ("102.82": digits, a dot, two decimals).
const API_AMOUNT = /^(\d+)\.(\d{2})$/;

// The whole grosze of an amount in the API's format ("102.82" → 10282), so sums and shares are
// worked out on integers, never on float decimals; null for anything else.
export function toGrosze(amount: string): number | null {
  const match = API_AMOUNT.exec(amount);
  return match === null ? null : Number(match[1]) * 100 + Number(match[2]);
}
