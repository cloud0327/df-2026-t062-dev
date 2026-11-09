import { existsSync, readFileSync } from 'node:fs';
import { text, circleMark } from '@pdfme/schemas';

export const ROOT = new URL('../', import.meta.url);

export const plugins = { text, circleMark };

export function loadFont() {
  return {
    BIZUDPGothic: {
      data: readFileSync(new URL('fonts/BIZUDPGothic-Regular.ttf', ROOT)),
      fallback: true,
      subset: true,
    },
  };
}

/**
 * template.json を読み、basePdf をファイルの中身に差し替える。
 * 元の PDF は公開リポジトリに入れていない（npm run forms:fetch）。withPdf: false なら、欄の位置だけを読む
 */
export function loadTemplate(formId, { withPdf = true } = {}) {
  const dir = new URL(`templates/${formId}/`, ROOT);
  const t = JSON.parse(readFileSync(new URL('template.json', dir), 'utf8'));
  if (withPdf && typeof t.basePdf === 'string' && t.basePdf.endsWith('.pdf')) {
    const file = new URL(t.basePdf, dir);
    if (!existsSync(file)) throw new Error(`様式の元の PDF がありません: templates/${formId}/${t.basePdf}（npm run forms:fetch。入院時情報提供書は手元に置いたときだけ）`);
    t.basePdf = new Uint8Array(readFileSync(file));
  }
  return t;
}

export function loadJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}
