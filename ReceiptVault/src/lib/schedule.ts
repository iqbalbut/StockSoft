/** Wall-clock parts of `at` in an IANA time zone. */
export function zonedParts(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    mi: Number(parts.minute),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
  };
}

/** YYYY-MM-DD for `at` in the time zone. */
export function zonedDate(at: Date, timeZone: string) {
  const p = zonedParts(at, timeZone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** The most recent occurrence (≤ now) of weekday/hour in the time zone, as a UTC Date. */
export function lastOccurrence(now: Date, timeZone: string, weekday: number, hour: number): Date {
  const p = zonedParts(now, timeZone);
  const localNowMs = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  const offset = localNowMs - Math.floor(now.getTime() / 60_000) * 60_000; // zone offset in ms
  let back = (p.weekday - weekday + 7) % 7;
  if (back === 0 && p.h < hour) back = 7;
  const localTarget = Date.UTC(p.y, p.m - 1, p.d - back, hour, 0);
  return new Date(localTarget - offset);
}

/** The most recent hh:00 (≤ now) in the time zone, as a UTC Date. */
export function lastDailyOccurrence(now: Date, timeZone: string, hour: number): Date {
  const p = zonedParts(now, timeZone);
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(now.getTime() / 60_000) * 60_000;
  return new Date(Date.UTC(p.y, p.m - 1, p.d - (p.h < hour ? 1 : 0), hour, 0) - offset);
}
