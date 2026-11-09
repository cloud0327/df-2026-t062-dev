# API 設計

本体は [`api/app.ts`](../api/app.ts)（Hono）。`/api/health.json` のほかは、毎回 `Authorization: Bearer <Identity Platform の ID トークン>` を確かめ、ログインしているケアマネの事業所で絞る。worker の道（`/tasks/*`）は api には置かない（[`worker/app.ts`](../worker/app.ts)）。

## 道の一覧

| メソッドとパス | すること | 主な応答 |
|---|---|---|
| `GET /api/health.json` | 動いているか（DB も Firebase も使わない） | `{status:"ok", source:"api"}` |
| `GET /api/me` | ログインしているケアマネと事業所 | `{staff}` |
| `GET /api/clients?q=&sort=updated\|name` | 利用者の一覧（氏名・性別・状況・要介護度・必須の入力数・次の訪問・新規か） | `{clients}` |
| `POST /api/clients` | 利用者を追加（`{name, sex?, status?}`）。空のアセスメントも作る | `201 {id, assessmentId}` |
| `GET /api/clients/:id` | 利用者・書類・処理中のジョブ | `{client, jobs}` |
| `POST /api/clients/:id/documents` | 入院時情報提供書を作る（`{form:"admission"}`）。アセスメントから写す。あれば今のものを返す | `201/200 {id}` |
| `GET /api/form-versions/:id` | 様式の版（欄の位置・対応・ページ）。その事業所が見てよい版だけ（ほかは 404）。中身は変わらないので `ETag`・`Cache-Control: private, immutable`（`If-None-Match` で 304） | `{formVersion}` |
| `GET /api/form-versions/:id/assets` | ページの画像の期限つきの URL（UTC の 0 時から 48 時間。同じ日は同じ URL）と、元の PDF が置き場にあるか。画像がまだなければ `url: null` | `{pages:[{no, url}], hasPdf, expiresAt}` |
| `GET /api/documents/:id` | 欄の今の値・保存した値・版の番号・最近の書き込み・使う様式の版 | `{document}`（`kind`、`formVersionId`） |
| `GET /api/documents/:id/sync-differences` | 入院時情報提供書と元のアセスメントの独立した欄を比較。`review` は元の保存済み値が前回の確認から変わった欄、`pending` は元の変更が未保存、`different` は元書類に新たな変更がない差異 | `{differences:[{key,label,source,target,status}]}` |
| `POST /api/documents/:id/sync-decisions` | 差異を欄ごとに「反映」または「今の記載を維持」。`{key,decision:"apply"\|"keep",source,target}` の両方が現在値と違えば 409。元の変更が未保存でも 409 | `{differences,document}` |
| `POST /api/documents/:id/edits` | 用紙の印字欄の直し（`{formVersionId, edits:[{slot, text}]}`）。書類の行を止め、その時点の値に、様式の版の対応で 1 つずつ当てる。当てられない直しは理由を返す（ほかは当てる）。画面の様式の版が書類の版と違えば 409 | `{results:[{slot, reason?}], syncedTo, document}` |
| `PATCH /api/documents/:id/fields` | 欄の値をそのまま変える直し（差分の欄の文章。`{changes:[{key, value, base, mode?}]}`）。`base` は画面が元にした値で、今の値と違えば 409（AI が書いたばかりの値を上書きしない）。`mode:"revert"` は「前の文に戻す」 | `{syncedTo, document}`（基本情報を直したら、ほかの書類の名前が `syncedTo` に入る） |
| `POST /api/documents/:id/save` | 保存（`{scope:"document"}`／`{scope:"page", page}`／`{scope:"hunk", key, hunkIndex}`） | `{rev, document}` |
| `GET /api/documents/:id/pdf` | 最新の版から、その版の様式の元の PDF で PDF を作る。出力の置き場にも残す。元の PDF が置き場になければ 503 | `application/pdf` |
| `POST /api/clients/:id/recordings` | 録音を始める（`{mime}`）。Cloud Storage の再開できる送信の URL を返す | `201 {recordingId, uploadUrl}` |
| `POST /api/recordings/:id/complete` | 送り終わり（`{durationMs}`）。置き場にあるのを確かめてジョブを積む | `202 {jobId, status}` |
| `GET /api/clients/:id/jobs` | 処理の状態（処理中と、終わって 15 分以内） | `{jobs:[{status, step, etaSeconds, batch:{changes, kept}}]}` |
| `PUT /api/dev-upload/:token` | ローカルの置き場だけ。Cloud Storage と同じ約束（Content-Range、途中は 308） | — |
| `GET /api/dev-files/forms/*?from=&until=&sig=` | ローカルの置き場だけ。期限つきの URL（署名つき URL と同じ約束。署名が違う・期限の外なら 403） | 画像・PDF |

## 入力の確かめ

- 体の形は zod で確かめる（`api/app.ts`）。
- 欄の値は、fields.json から作った型（`core/schema.ts`）で確かめる。選択肢にない値は 400。
- その書類の様式の版にない key・印字欄は 400（`db/repo.ts` の `allowedKeys`）。

## 誤りの返し方

| 状態 | いつ |
|---|---|
| 401 | トークンがない・正しくない |
| 403 | トークンは正しいが、どの事業所にも登録されていない |
| 404 | ない、またはほかの事業所のもの |
| 400 | 入力の形・値が違う |
| 409 | 録音がまだ置き場に届いていない。直しの元にした値（`base`）や様式の版が、サーバーで変わっていた（画面は読み直す） |
| 503 | 様式の元の PDF が置き場にない（`npm run forms:assets`） |
| 500 | それ以外。ログには道と誤りの種類だけを出す（中身は出さない） |

## worker の道（非公開）

| メソッドとパス | 呼ぶもの | すること |
|---|---|---|
| `POST /tasks/jobs/:id/run` | Cloud Tasks（OIDC） | 録音 1 本の処理。応答の前に終える。失敗は 500（Cloud Tasks が間をあけてやり直す） |
| `POST /tasks/reconcile` | Cloud Scheduler（5 分ごと） | 積み損ね・止まった処理を積み直す |
| `GET /health` | — | 動いているか |
