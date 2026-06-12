export type PluralForms = [one: string, few: string, many: string];

// Russian pluralization. forms = [one, few, many]:
//   one  — 1, 21, 121 ...      («1 заявка»)
//   few  — 2-4, 22-24 ...      («2 заявки»)
//   many — 0, 5-20, 11-14 ...  («5 заявок», «11 заявок»)
// Correctly handles the 11-14 exception (always "many" despite ending in 1-4).
export function pluralize(count: number, forms: PluralForms): string {
  const n = Math.abs(Math.trunc(count));
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

// "5 заявок" — count plus its correct plural form.
export function plural(count: number, forms: PluralForms): string {
  return `${count} ${pluralize(count, forms)}`;
}
