import { isIsoDate } from "./invoice-validation";

export function calendarDaysBetween(from: string, to: string) {
  if (!isIsoDate(from) || !isIsoDate(to)) throw new Error("Neplatné datum reportu.");
  const dayNumber = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  };
  return dayNumber(to) - dayNumber(from);
}
