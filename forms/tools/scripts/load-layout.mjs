// layout.json を読む（Node だけ）。欄の位置を作るスクリプトから使う。
import { readFileSync } from 'node:fs';
import { LayoutPage } from './layout.mjs';

export function loadLayout(formId) {
  const url = new URL(`../templates/${formId}/layout.json`, import.meta.url);
  const d = JSON.parse(readFileSync(url, 'utf8'));
  const pages = d.pages.map((p) => new LayoutPage(p));
  return { page: (n) => pages[n - 1], pages };
}
