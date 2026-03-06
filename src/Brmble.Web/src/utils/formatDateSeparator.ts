function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const aDay = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bDay = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((aDay.getTime() - bDay.getTime()) / msPerDay);
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatDateSeparator(date: Date): string {
  const now = new Date();

  if (isSameDay(date, now)) {
    return 'Today';
  }

  const diff = daysBetween(now, date);

  if (diff === 1) {
    return 'Yesterday';
  }

  if (diff < 7) {
    return WEEKDAYS[date.getDay()];
  }

  return formatFullDate(date);
}

/** Always returns the full date string, e.g. "Wednesday, March 4, 2026". */
export function formatFullDate(date: Date): string {
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
