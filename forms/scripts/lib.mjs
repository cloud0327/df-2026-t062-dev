import { readFileSync } from 'node:fs';
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

/** template.json を読み、basePdf をファイルの中身に差し替える */
export function loadTemplate(formId) {
  const dir = new URL(`templates/${formId}/`, ROOT);
  const t = JSON.parse(readFileSync(new URL('template.json', dir), 'utf8'));
  if (typeof t.basePdf === 'string' && t.basePdf.endsWith('.pdf')) {
    t.basePdf = new Uint8Array(readFileSync(new URL(t.basePdf, dir)));
  }
  return t;
}

export function loadJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}
