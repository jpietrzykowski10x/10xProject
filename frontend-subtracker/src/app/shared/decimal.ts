// Spaces a person may type or paste between thousands: a plain space, a no-break space (what the
// Polish number format prints, "1 233,87") and a narrow no-break space.
const GROUP_SEPARATORS = /[   ]/g;

// A non-negative decimal typed with a comma or a dot ("43,5", "43.50", "1 233,87"), or null for
// anything else: letters, a sign, two separators, or more than `maxFractionDigits` decimals.
export function parseDecimal(value: string, maxFractionDigits: number): number | null {
  const compact = value.trim().replace(GROUP_SEPARATORS, '');
  // String.raw keeps `\d` intact; in a plain template literal it would turn into a bare "d".
  // With no decimals allowed there is no fraction part at all ("{1,0}" is not a valid quantifier).
  const fraction = maxFractionDigits > 0 ? String.raw`(?:[.,]\d{1,${maxFractionDigits}})?` : '';
  const pattern = new RegExp(String.raw`^\d+${fraction}$`);
  return pattern.test(compact) ? Number(compact.replace(',', '.')) : null;
}
