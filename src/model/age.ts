const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseCalendarDate(name: string, value: string): CalendarDateParts {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) throw new TypeError(`${name} must use YYYY-MM-DD format`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`${name} must be a real calendar date`);
  }
  return { year, month, day };
}

function compareDates(left: CalendarDateParts, right: CalendarDateParts): number {
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

/** Calculates completed calendar years without consulting the current clock. */
export function calculateAge(dateOfBirth: string, referenceDate: string): number {
  const birth = parseCalendarDate("dateOfBirth", dateOfBirth);
  const reference = parseCalendarDate("referenceDate", referenceDate);
  if (compareDates(birth, reference) > 0) {
    throw new RangeError("dateOfBirth must not be after referenceDate");
  }

  const birthdayOccurred = reference.month > birth.month
    || (reference.month === birth.month && reference.day >= birth.day);
  return reference.year - birth.year - (birthdayOccurred ? 0 : 1);
}
