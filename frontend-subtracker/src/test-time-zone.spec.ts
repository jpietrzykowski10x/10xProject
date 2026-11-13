// Guards the two-zone run (scripts/test-time-zones.mjs): without it the suite could silently run in
// UTC, where day-shift bugs in date handling stay hidden.
const timeZone = process.env['TZ'];

// A winter date, so neither zone is on daylight saving time.
const WINTER_DAY = new Date(2026, 0, 15);

// Zones east of Greenwich have a negative offset in getTimezoneOffset, zones west a positive one.
const EXPECTED_OFFSET_SIGN: Record<string, number> = {
  'Europe/Warsaw': -1,
  'America/New_York': 1,
};

describe('test time zone', () => {
  it.skipIf(!timeZone)(`runs the tests in the zone from TZ (${timeZone ?? 'TZ not set'})`, () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(timeZone);
  });

  // A zone outside the list fails instead of being skipped: a run in UTC (offset 0) or in a zone
  // nobody chose would prove nothing about day shifts.
  it.skipIf(!timeZone)(
    `has a winter UTC offset on the expected side of Greenwich (${timeZone ?? 'TZ not set'})`,
    () => {
      expect(Object.keys(EXPECTED_OFFSET_SIGN)).toContain(timeZone);
      expect(Math.sign(WINTER_DAY.getTimezoneOffset())).toBe(EXPECTED_OFFSET_SIGN[timeZone ?? '']);
    },
  );
});
