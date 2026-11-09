// 様式の一覧。id はテンプレートのフォルダ名、fieldsForm は fields.json の forms のキー
export const FORMS = {
  admission: { label: '入院時情報提供書', module: '../templates/admission/mapping.mjs', fieldsForm: 'adm' },
  assessment: { label: 'アセスメント', module: '../templates/assessment/index.mjs', fieldsForm: 'assess' },
};

export async function loadForm(id) {
  const f = FORMS[id];
  if (!f) throw new Error(`様式 ${id} はありません（${Object.keys(FORMS).join(', ')}）`);
  const mod = await import(new URL(f.module, import.meta.url));
  return { id, ...f, toInputs: mod.toInputs, usesKeys: mod.usesKeys };
}
