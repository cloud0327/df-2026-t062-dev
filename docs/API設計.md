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
| `GET /api/documents/:id` | 欄の今の値・保存した値・版の番号・最近の書き込み | `{document}` |
| `PATCH /api/documents/:id/fields` | ケアマネの直し（`{changes:[{key, value, mode?}]}`）。`mode:"revert"` は「前の文に戻す」 | `{syncedTo, document}`（基本情報を直したら、ほかの書類の名前が `syncedTo` に入る） |
| `POST /api/documents/:id/save` | 保存（`{scope:"document"}`／`{scope:"page", page}`／`{scope:"hunk", key, hunkIndex}`） | `{rev, document}` |
| `GET /api/documents/:id/pdf` | 最新の版から PDF を作る。出力の置き場にも残す | `application/pdf` |
| `POST /api/clients/:id/recordings` | 録音を始める（`{mime}`）。Cloud Storage の再開できる送信の URL を返す | `201 {recordingId, uploadUrl}` |
| `POST /api/recordings/:id/complete` | 送り終わり（`{durationMs}`）。置き場にあるのを確かめてジョブを積む | `202 {jobId, status}` |
| `GET /api/clients/:id/jobs` | 処理の状態（処理中と、終わって 15 分以内） | `{jobs:[{status, step, etaSeconds, batch:{changes, kept}}]}` |
| `PUT /api/dev-upload/:token` | ローカルの置き場だけ。Cloud Storage と同じ約束（Content-Range、途中は 308） | — |

## 入力の確かめ

- 体の形は zod で確かめる（`api/app.ts`）。
- 欄の値は、fields.json から作った型（`core/schema.ts`）で確かめる。選択肢にない値は 400。
- その書類の様式にない key は 400（`db/repo.ts` の `allowedKey`）。

## 誤りの返し方

| 状態 | いつ |
|---|---|
| 401 | トークンがない・正しくない |
| 403 | トークンは正しいが、どの事業所にも登録されていない |
| 404 | ない、またはほかの事業所のもの |
| 400 | 入力の形・値が違う |
| 409 | 録音がまだ置き場に届いていない |
| 500 | それ以外。ログには道と誤りの種類だけを出す（中身は出さない） |

## worker の道（非公開）

| メソッドとパス | 呼ぶもの | すること |
|---|---|---|
| `POST /tasks/jobs/:id/run` | Cloud Tasks（OIDC） | 録音 1 本の処理。応答の前に終える。失敗は 500（Cloud Tasks が間をあけてやり直す） |
| `POST /tasks/reconcile` | Cloud Scheduler（5 分ごと） | 積み損ね・止まった処理を積み直す |
| `GET /healthz` | — | 動いているか |
