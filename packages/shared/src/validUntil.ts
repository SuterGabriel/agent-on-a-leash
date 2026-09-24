// When the leash ends: "until Friday", "bis 30. September", "for the next two weeks", "today only".
// Relative phrases are anchored at `now`, the real clock when the customer writes the leash. The end is always
// 23:59:59 Swiss time on that day. Purchases are then judged against their simulated timestamp, like every other
// time rule (weekday, rolling budget), so a replayed scenario is not "expired" just because it was recorded in August.
// Patterns are general English and German phrasings; nothing here names a scenario.

export interface ValidUntil {
  /** ISO instant, 23:59:59 Swiss time on the last valid day. */
  until: string;
  /** "Fri 26 Sep 2026" */
  label: string;
  /** The customer's words, with offsets into the instruction. */
  text: string;
  start: number;
  end: number;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, sonntag: 0, so: 0,
  monday: 1, mon: 1, montag: 1, mo: 1,
  tuesday: 2, tue: 2, tues: 2, dienstag: 2, di: 2,
  wednesday: 3, wed: 3, mittwoch: 3, mi: 3,
  thursday: 4, thu: 4, thurs: 4, donnerstag: 4, do: 4,
  friday: 5, fri: 5, freitag: 5, fr: 5,
  saturday: 6, sat: 6, samstag: 6, sa: 6,
};
const MONTHS: Record<string, number> = {
  jan: 0, january: 0, januar: 0,
  feb: 1, february: 1, februar: 1,
  mar: 2, march: 2, märz: 2, maerz: 2,
  apr: 3, april: 3,
  may: 4, mai: 4,
  jun: 5, june: 5, juni: 5,
  jul: 6, july: 6, juli: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, okt: 9, oktober: 9,
  nov: 10, november: 10,
  dec: 11, december: 11, dez: 11, dezember: 11,
};
const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fourteen: 14, thirty: 30,
  ein: 1, eine: 1, einen: 1, einer: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, vierzehn: 14,
};
const toNumber = (w: string) => NUMBER_WORDS[w.toLowerCase()] ?? Number(w);

// ── Swiss calendar arithmetic ──────────────────────────────────────────────────────────────────────

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

type SwissDate = { y: number; m: number; d: number }; // m is 1-12

function swissParts(ms: number) {
  const p: Record<string, string> = {};
  for (const part of partsFmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) };
}

/** The Swiss calendar date at this instant. */
export function swissDate(ms: number): SwissDate {
  const p = swissParts(ms);
  return { y: p.y, m: p.m, d: p.d };
}

/** Pure calendar arithmetic, no time zone involved. */
function addDays(date: SwissDate, n: number): SwissDate {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function weekdayOf(date: SwissDate): number {
  return new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** UTC ms of 23:59:59 Swiss time on that Swiss calendar day (summer and winter time handled). */
export function endOfSwissDay(date: SwissDate): number {
  const guess = Date.UTC(date.y, date.m - 1, date.d, 23, 59, 59);
  const p = swissParts(guess);
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return guess - (wall - guess);
}

export function formatSwissDay(ms: number): string {
  const date = swissDate(ms);
  return `${WEEKDAY_NAMES[weekdayOf(date)]} ${date.d} ${MONTH_NAMES[date.m - 1]} ${date.y}`;
}

// ── Patterns ───────────────────────────────────────────────────────────────────────────────────────

const UNTIL = String.raw`(?:valid\s+|gültig\s+|gueltig\s+)?(?:until|till|through|up\s+to\s+and\s+including|by|bis(?:\s+(?:zum|zur|am|und\s+mit))?)`;
const OPT_THE = String.raw`(?:\s+(?:the|den|dem|der))?`;
const WEEKDAY = String.raw`(?<wd>sunday|sun|sonntag|monday|mon|montag|tuesday|tues|tue|dienstag|wednesday|wed|mittwoch|thursday|thurs|thu|donnerstag|friday|fri|freitag|saturday|sat|samstag)`;
const MONTH = String.raw`(?<mon>january|jan|januar|february|feb|februar|march|mar|märz|maerz|april|apr|may|mai|june|jun|juni|july|jul|juli|august|aug|september|sept|sep|october|oct|oktober|okt|november|nov|december|dec|dezember|dez)`;
const NUM = String.raw`(?<n>\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fourteen|thirty|ein|eine|einen|einer|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|vierzehn)`;

type Kind = "weekday" | "dayMonth" | "monthDay" | "numeric" | "iso" | "endOfMonth" | "endOfWeek" | "duration" | "today" | "thisWeek" | "thisWeekend";

const PATTERNS: [Kind, RegExp][] = [
  ["iso", new RegExp(String.raw`\b${UNTIL}\s+(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})\b`, "i")],
  ["numeric", new RegExp(String.raw`\b${UNTIL}${OPT_THE}\s+(?<d>\d{1,2})\.\s?(?<m>\d{1,2})\.(?:\s?(?<y>\d{4}))?(?!\d)`, "i")],
  ["dayMonth", new RegExp(String.raw`\b${UNTIL}${OPT_THE}\s+(?<d>\d{1,2})(?:st|nd|rd|th|\.)?\s*(?:of\s+)?${MONTH}\b\.?(?:\s+(?<y>\d{4}))?`, "i")],
  ["monthDay", new RegExp(String.raw`\b${UNTIL}\s+${MONTH}\s+(?<d>\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(?<y>\d{4}))?`, "i")],
  ["endOfMonth", new RegExp(String.raw`\b(?:${UNTIL}${OPT_THE}\s+end\s+of\s+(?:the\s+|this\s+)?month|bis\s+(?:zum\s+)?(?:ende\s+(?:des\s+)?monats?|monatsende)|this\s+month\s+only|nur\s+(?:noch\s+)?diesen\s+monat)\b`, "i")],
  ["endOfWeek", new RegExp(String.raw`\b(?:${UNTIL}${OPT_THE}\s+end\s+of\s+(?:the\s+|this\s+)?week|bis\s+(?:zum\s+)?(?:ende\s+(?:der\s+)?woche|wochenende)|this\s+week\s+only|nur\s+(?:noch\s+)?diese\s+woche)\b`, "i")],
  ["thisWeekend", new RegExp(String.raw`\b(?:this\s+weekend\s+only|only\s+this\s+weekend|nur\s+(?:an\s+)?diesem\s+wochenende)\b`, "i")],
  ["weekday", new RegExp(String.raw`\b${UNTIL}${OPT_THE}\s+(?<next>next\s+|nächsten\s+|naechsten\s+|this\s+|diesen\s+)?${WEEKDAY}\b`, "i")],
  ["today", new RegExp(String.raw`\b(?:today\s+only|only\s+(?:for\s+)?today|just\s+(?:for\s+)?today|nur\s+heute|heute\s+nur|bis\s+heute\s+abend|until\s+tonight)\b`, "i")],
  ["duration", new RegExp(String.raw`\b(?:valid\s+|gültig\s+)?(?:for|für)\s+(?:the\s+|die\s+)?(?:next\s+|coming\s+|nächsten\s+|naechsten\s+|kommenden\s+)?${NUM}\s+(?<unit>days?|weeks?|months?|tage?n?|wochen?|monate?n?)\b`, "i")],
];

// "CHF 200 for two weeks" is a budget, "returns accepted for 14 days" a return term: never a validity.
const AMOUNT_BEFORE = /(?:\d|chf|fr\.|sfr\.?|franken|francs?|€|\$|£|eur|usd|gbp|within|innerhalb|innert|every|each|per|pro|any)\s*$/i;
const CLAUSE_ABOUT_SOMETHING_ELSE = /\b(?:return\w*|refund\w*|rückgabe\w*|umtausch\w*|warrant\w*|guarantee|garantie|budget|total|limit|spend\w*|ausgeben)\b/i;
/** The clause the match sits in, back to the previous comma, full stop or semicolon (at most 40 characters). */
const clauseBefore = (text: string, index: number) => text.slice(Math.max(0, index - 40), index).split(/[.,;:!?]/).pop() ?? "";

/**
 * The end of the leash, if the instruction names one. `now` anchors "Friday", "two weeks" and "today" (real clock).
 * "until further notice" and no phrase at all both mean no end.
 */
export function parseValidUntil(instruction: string, now: number = Date.now()): ValidUntil | null {
  const today = swissDate(now);
  for (const [kind, re] of PATTERNS) {
    const g = new RegExp(re.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = g.exec(instruction))) {
      if (kind === "duration") {
        const before = clauseBefore(instruction, m.index);
        if (AMOUNT_BEFORE.test(before) || CLAUSE_ABOUT_SOMETHING_ELSE.test(before)) continue;
      }
      const date = resolve(kind, m.groups ?? {}, today);
      if (!date) continue;
      const until = endOfSwissDay(date);
      const text = m[0].replace(/^[\s,]+|[\s,]+$/g, "");
      const start = m.index + m[0].indexOf(text);
      return { until: new Date(until).toISOString(), label: formatSwissDay(until), text, start, end: start + text.length };
    }
  }
  return null;
}

function resolve(kind: Kind, g: Record<string, string | undefined>, today: SwissDate): SwissDate | null {
  const valid = (d: SwissDate) => (d.m >= 1 && d.m <= 12 && d.d >= 1 && d.d <= lastDayOfMonth(d.y, d.m) ? d : null);
  const nextOccurrence = (m: number, d: number, y?: number): SwissDate | null => {
    if (y !== undefined) return valid({ y, m, d });
    const thisYear = valid({ y: today.y, m, d });
    if (!thisYear) return null;
    const past = thisYear.m < today.m || (thisYear.m === today.m && thisYear.d < today.d);
    return past ? valid({ y: today.y + 1, m, d }) : thisYear;
  };
  switch (kind) {
    case "iso":
      return valid({ y: Number(g.y), m: Number(g.m), d: Number(g.d) });
    case "numeric":
      return nextOccurrence(Number(g.m), Number(g.d), g.y ? Number(g.y) : undefined);
    case "dayMonth":
    case "monthDay": {
      const month = MONTHS[(g.mon ?? "").toLowerCase()];
      return month === undefined ? null : nextOccurrence(month + 1, Number(g.d), g.y ? Number(g.y) : undefined);
    }
    case "endOfMonth":
      return { y: today.y, m: today.m, d: lastDayOfMonth(today.y, today.m) };
    case "endOfWeek":
    case "thisWeekend":
      return addDays(today, (7 - weekdayOf(today)) % 7); // Sunday
    case "weekday": {
      const wd = WEEKDAYS[(g.wd ?? "").toLowerCase()];
      if (wd === undefined) return null;
      let ahead = (wd - weekdayOf(today) + 7) % 7;
      if (ahead === 0 && /^n/i.test(g.next ?? "")) ahead = 7;
      return addDays(today, ahead);
    }
    case "today":
      return today;
    case "thisWeek":
      return addDays(today, (7 - weekdayOf(today)) % 7);
    case "duration": {
      const n = toNumber(g.n ?? "");
      if (!(n > 0) || !Number.isInteger(n)) return null;
      const unit = (g.unit ?? "").toLowerCase();
      if (/^(?:month|monat)/.test(unit)) {
        const total = today.m - 1 + n;
        const y = today.y + Math.floor(total / 12);
        const m = (total % 12) + 1;
        return { y, m, d: Math.min(today.d, lastDayOfMonth(y, m)) };
      }
      const days = /^(?:week|woche)/.test(unit) ? n * 7 : n;
      // "for 7 days" written today: today plus six more days, so the window has exactly n days.
      return addDays(today, days - 1);
    }
  }
}
