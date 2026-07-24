// Кастомные форматтеры вместо Intl: русская локаль без громоздкого "г."
// и с годом — данные охватывают несколько лет, дата без года неоднозначна.
const RU_MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const RU_WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

export const shortDateFmt = {
  format: (d: Date) => `${d.getDate()} ${RU_MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
};

export const weekdayDateFmt = {
  format: (d: Date) =>
    `${RU_WEEKDAYS_SHORT[d.getDay()]}, ${d.getDate()} ${RU_MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
};

export const hmsTimeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

// `Intl.NumberFormat.prototype.format` is a bound getter — safe to extract.
export const intFmt = new Intl.NumberFormat("en-US").format;
