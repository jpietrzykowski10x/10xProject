const AMOUNT_FORMAT = /^(\d+)\.(\d{2})$/;

// An amount in the API's format ("43.00", a numeric(10,2) column read back as a string) as whole
// grosze (4300), so that sums and divisions never touch a float decimal. Any other format means a
// programming error, not user input, so it throws.
export function toGrosze(amount: string): number {
  const match = AMOUNT_FORMAT.exec(amount);
  if (match === null) {
    throw new Error(
      `Not an amount with two decimals: ${JSON.stringify(amount)}`,
    );
  }
  return Number(match[1]) * 100 + Number(match[2]);
}

// A non-negative whole number of grosze in the API's format (10282 → "102.82").
export function fromGrosze(grosze: number): string {
  if (!Number.isSafeInteger(grosze) || grosze < 0) {
    throw new Error(`Not a non-negative whole number of grosze: ${grosze}`);
  }
  return `${Math.floor(grosze / 100)}.${String(grosze % 100).padStart(2, '0')}`;
}
