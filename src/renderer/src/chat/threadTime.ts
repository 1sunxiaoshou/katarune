const SAME_DAY_JUST_NOW_MS = 60_000;

function sameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
}

function twoDigits(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatThreadTime(
  value: Date | undefined,
  now = new Date(),
): string {
  if (value === undefined || Number.isNaN(value.getTime())) return "";

  if (sameCalendarDay(value, now)) {
    const elapsed = now.getTime() - value.getTime();
    if (elapsed >= 0 && elapsed < SAME_DAY_JUST_NOW_MS) return "刚刚";
    return `今天 ${twoDigits(value.getHours())}:${twoDigits(value.getMinutes())}`;
  }

  const calendarDays =
    (startOfDay(now).getTime() - startOfDay(value).getTime()) / 86_400_000;
  if (calendarDays >= 1 && calendarDays <= 6) {
    return new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(value);
  }

  if (value.getFullYear() === now.getFullYear()) {
    return `${value.getMonth() + 1} 月 ${value.getDate()} 日`;
  }

  return `${value.getFullYear()} 年 ${value.getMonth() + 1} 月 ${value.getDate()} 日`;
}
