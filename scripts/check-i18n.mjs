/**
 * Verifies that every translation key referenced in the source actually exists,
 * and that the MN and EN catalogues stay at parity.
 *
 * A missing key is invisible at build time and surfaces as a raw key string in
 * the UI — or, with next-intl, as a console error on an otherwise fine-looking
 * page. Cheap to check, so it is checked.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const mn = JSON.parse(readFileSync('messages/mn.json', 'utf8'));
const has = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), mn) !== undefined;

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
})('src');

const missing = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  // Map each translator variable to the namespace it was created with.
  const ns = {};
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*["'`]([^"'`]*)["'`]?\s*\)/g)) {
    ns[m[1]] = m[2];
  }
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*\)/g)) {
    ns[m[1]] = '';
  }
  for (const [varName, namespace] of Object.entries(ns)) {
    const re = new RegExp(`\\b${varName}\\(\\s*["'\`]([A-Za-z0-9_.]+)["'\`]`, 'g');
    for (const m of src.matchAll(re)) {
      const full = namespace ? `${namespace}.${m[1]}` : m[1];
      if (!has(full)) missing.push(`${file}: ${varName}("${m[1]}") -> ${full}`);
    }
  }
}
const en = JSON.parse(readFileSync('messages/en.json', 'utf8'));
const flatten = (o, prefix = '') =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
const mnKeys = new Set(flatten(mn));
const enKeys = new Set(flatten(en));
const onlyMn = [...mnKeys].filter((k) => !enKeys.has(k));
const onlyEn = [...enKeys].filter((k) => !mnKeys.has(k));

let failed = false;
if (missing.length) {
  console.error('Missing translation keys:');
  missing.forEach((m) => console.error('  ' + m));
  failed = true;
}
if (onlyMn.length || onlyEn.length) {
  console.error('Catalogue parity broken:');
  onlyMn.forEach((k) => console.error('  only in mn: ' + k));
  onlyEn.forEach((k) => console.error('  only in en: ' + k));
  failed = true;
}
if (failed) process.exit(1);

console.log(
  `i18n ok — ${files.length} files scanned, ${mnKeys.size} keys at mn/en parity`,
);
