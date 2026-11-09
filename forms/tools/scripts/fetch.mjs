// 様式の元の PDF を、様式を作る道具（forms/tools/templates/<様式>/base.pdf）とテストのために用意する。
//
// 様式の PDF とそこから作った画像・座標データは、公開リポジトリに入れない（利用条件のため。2026-11-09 に決めた）。
//   アセスメント: 全社協が公開している PDF を、公式の URL から取ってくる（中身が同じかをハッシュで確かめる）
//   入院時情報提供書: 公開されていない地域の版なので、手元に forms/tools/templates/admission/base.pdf を置いたときだけ使う
// サービスで使う PDF とページの画像は、npm run forms:assets が非公開の置き場に入れる（forms/admin/assets.ts）。
//
//   npm run forms:fetch
import { ensurePdf } from '../../admin/pdf.ts'

for (const kind of ['assessment', 'admission']) {
  const r = await ensurePdf(kind)
  console.log(`${kind}: ${r.message}`)
}
