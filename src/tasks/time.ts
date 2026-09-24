import type { TaskRecurrence } from "./types.js";

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Missing date part: ${type}`);
    return part.value;
  };

  const weekday = read("weekday");
  const dayOfWeek = WEEKDAY_MAP[weekday];
  if (dayOfWeek === undefined) {
    throw new Error(`Unknown weekday: ${weekday}`);
  }

  let hour = Number(read("hour"));
  // Some environments still emit "24" for midnight with hourCycle h23.
  if (hour === 24) hour = 0;

  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour,
    minute: Number(read("minute")),
    second: Number(read("second")),
    dayOfWeek,
  };
}

/** Convert a civil local datetime in `timeZone` to a UTC Date. */
export function zonedLocalToUtc(
  local: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second?: number;
  },
  timeZone: string,
): Date {
  const second = local.second ?? 0;
  let utcMs = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    second,
  );

  for (let i = 0; i < 3; i += 1) {
    const asZoned = getZonedParts(new Date(utcMs), timeZone);
    const asZonedMs = Date.UTC(
      asZoned.year,
      asZoned.month - 1,
      asZoned.day,
      asZoned.hour,
      asZoned.minute,
      asZoned.second,
    );
    const desiredMs = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      second,
    );
    const diff = desiredMs - asZonedMs;
    if (diff === 0) break;
    utcMs += diff;
  }

  return new Date(utcMs);
}

/**
 * Parse dueAt from the LLM.
 * Absolute ISO with Z/offset is used as-is.
 * Naive local datetimes are interpreted in ANDRU_TIMEZONE.
 */
export function parseDueAt(
  input: string,
  timeZone: string,
): Date {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("dueAt is required");
  }

  // Has explicit offset or Z → absolute instant
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid dueAt: ${input}`);
    }
    return date;
  }

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!match) {
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid dueAt: ${input}`);
    }
    return date;
  }

  return zonedLocalToUtc(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4] ?? "0"),
      minute: Number(match[5] ?? "0"),
      second: Number(match[6] ?? "0"),
    },
    timeZone,
  );
}

export function nextOccurrence(
  recurrence: TaskRecurrence,
  timeZone: string,
  after: Date,
): Date {
  if (recurrence.frequency === "daily") {
    return nextDaily(recurrence.hour, recurrence.minute, timeZone, after);
  }

  if (recurrence.dayOfWeek === undefined || recurrence.dayOfWeek < 0 || recurrence.dayOfWeek > 6) {
    throw new Error("weekly recurrence requires dayOfWeek 0-6 (Sunday=0)");
  }

  return nextWeekly(
    recurrence.dayOfWeek,
    recurrence.hour,
    recurrence.minute,
    timeZone,
    after,
  );
}

function nextDaily(
  hour: number,
  minute: number,
  timeZone: string,
  after: Date,
): Date {
  const zoned = getZonedParts(after, timeZone);
  let candidate = zonedLocalToUtc(
    {
      year: zoned.year,
      month: zoned.month,
      day: zoned.day,
      hour,
      minute,
      second: 0,
    },
    timeZone,
  );
  if (candidate.getTime() <= after.getTime()) {
    const tomorrow = new Date(after.getTime() + 24 * 60 * 60 * 1000);
    const t = getZonedParts(tomorrow, timeZone);
    // Prefer calendar +1 day from today's zoned date to avoid DST edge glitches.
    const nextDay = addCalendarDays(zoned.year, zoned.month, zoned.day, 1);
    candidate = zonedLocalToUtc(
      { ...nextDay, hour, minute, second: 0 },
      timeZone,
    );
    // If still not after (rare DST), bump again using wall clock from `t`.
    if (candidate.getTime() <= after.getTime()) {
      const bump = addCalendarDays(t.year, t.month, t.day, 0);
      candidate = zonedLocalToUtc(
        { ...bump, hour, minute, second: 0 },
        timeZone,
      );
    }
  }
  return candidate;
}

function nextWeekly(
  dayOfWeek: number,
  hour: number,
  minute: number,
  timeZone: string,
  after: Date,
): Date {
  const zoned = getZonedParts(after, timeZone);
  let daysAhead = (dayOfWeek - zoned.dayOfWeek + 7) % 7;
  let target = addCalendarDays(zoned.year, zoned.month, zoned.day, daysAhead);
  let candidate = zonedLocalToUtc(
    { ...target, hour, minute, second: 0 },
    timeZone,
  );
  if (candidate.getTime() <= after.getTime()) {
    target = addCalendarDays(target.year, target.month, target.day, 7);
    candidate = zonedLocalToUtc(
      { ...target, hour, minute, second: 0 },
      timeZone,
    );
  }
  return candidate;
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

export function formatInstantForZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
