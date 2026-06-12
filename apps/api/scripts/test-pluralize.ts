// Unit test for the Russian pluralization utility. Run: tsx scripts/test-pluralize.ts
import { plural, pluralize } from "../src/common/pluralize";

const FORMS: [string, string, string] = ["заявка", "заявки", "заявок"];

// [input, expected form]. Covers the 11-14 exception and the *21/*121 carry-over.
const CASES: Array<[number, string]> = [
  [0, "заявок"],
  [1, "заявка"],
  [2, "заявки"],
  [3, "заявки"],
  [4, "заявки"],
  [5, "заявок"],
  [11, "заявок"],
  [12, "заявок"],
  [14, "заявок"],
  [15, "заявок"],
  [21, "заявка"],
  [22, "заявки"],
  [25, "заявок"],
  [111, "заявок"],
  [112, "заявок"],
  [121, "заявка"],
  [122, "заявки"]
];

let failures = 0;
for (const [n, expected] of CASES) {
  const got = pluralize(n, FORMS);
  const ok = got === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} pluralize(${n}) -> "${got}"${ok ? "" : ` expected "${expected}"`}`);
}

// plural() prepends the number.
const withCount = plural(5, FORMS);
if (withCount !== "5 заявок") {
  failures += 1;
  console.log(`  FAIL plural(5) -> "${withCount}" expected "5 заявок"`);
} else {
  console.log(`  ok   plural(5) -> "${withCount}"`);
}

if (failures > 0) {
  console.error(`\npluralize test FAILED (${failures})`);
  process.exit(1);
}
console.log("\npluralize test passed");
