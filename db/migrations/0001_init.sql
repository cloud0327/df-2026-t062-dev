-- ケア書類アシスタントの最初の形。説明は docs/DB設計.md。
-- すべての表に office_id を持ち、api のリポジトリ層で必ず事業所で絞る。

CREATE TABLE offices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  fax text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES offices(id),
  auth_uid text NOT NULL UNIQUE,
  name text NOT NULL,
  email text,
  role text NOT NULL DEFAULT 'caremanager' CHECK (role IN ('caremanager', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES offices(id),
  name text NOT NULL,
  status text NOT NULL DEFAULT '在宅' CHECK (status IN ('在宅', '入院中', '入所中')),
  next_visit_at timestamptz,
  next_visit_note text,
  created_by uuid REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX clients_office ON clients (office_id) WHERE archived_at IS NULL;

-- 話した人（次の録音でも同じ人にする）
CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES offices(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  label text NOT NULL,
  role text NOT NULL CHECK (role IN ('本人', '家族', '専門職', 'ケアマネ', '不明')),
  relation text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, label)
);

-- 様式（全社協のアセスメント用紙、地域の入院時情報提供書など）。office_id が NULL なら全事業所で使う。
-- 種類（kind）と使う範囲ごとに 1 つ。事業所の様式があれば、その事業所ではそれを使う
CREATE TABLE form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('assessment', 'admission')),
  name text NOT NULL,
  title text NOT NULL,
  publisher text,
  source_url text,
  office_id uuid REFERENCES offices(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT form_templates_scope UNIQUE NULLS NOT DISTINCT (kind, office_id)
);

-- 様式の版。中身（欄の位置・対応・ページ）は書き換えない・消さない（直すときは新しい版）。
-- 使う版（published）は様式に 1 つ。元の PDF とページの画像は、非公開の置き場の pdf/<base_pdf_sha256>/ に置く（同じ PDF の版どうしで同じファイル）
CREATE TABLE form_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES form_templates(id),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  -- pdfme の欄の位置（ページごと）
  schemas jsonb NOT NULL,
  -- 印字欄 → 欄の値の対応（core/binding.ts）
  bindings jsonb NOT NULL,
  -- [{no, pdfIndex, title, width, height}]
  pages jsonb NOT NULL,
  content_sha text NOT NULL,
  base_pdf_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  retired_at timestamptz,
  UNIQUE (template_id, version)
);
CREATE UNIQUE INDEX form_versions_one_published ON form_template_versions (template_id) WHERE status = 'published';

CREATE FUNCTION form_versions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '様式の版は消せません';
  END IF;
  IF NEW.template_id <> OLD.template_id OR NEW.version <> OLD.version
     OR NEW.schemas IS DISTINCT FROM OLD.schemas OR NEW.bindings IS DISTINCT FROM OLD.bindings OR NEW.pages IS DISTINCT FROM OLD.pages
     OR NEW.content_sha <> OLD.content_sha OR NEW.base_pdf_sha256 <> OLD.base_pdf_sha256 THEN
    RAISE EXCEPTION '様式の版の中身は書き換えられません。新しい版を作ってください';
  END IF;
  IF NOT (NEW.status = OLD.status OR (OLD.status = 'draft' AND NEW.status = 'published') OR (OLD.status = 'published' AND NEW.status = 'retired')) THEN
    RAISE EXCEPTION '様式の版の状態は draft → published → retired の順にしか変えられません';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER form_versions_guard BEFORE UPDATE OR DELETE ON form_template_versions FOR EACH ROW EXECUTE FUNCTION form_versions_guard();

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES offices(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  kind text NOT NULL CHECK (kind IN ('assessment', 'admission')),
  -- 書類が使う様式の版（作ったときに決める。版を移すのは npm run forms:rebase だけ）
  template_version_id uuid NOT NULL REFERENCES form_template_versions(id),
  -- AI の書き込みを反映している間だけ用紙を止める（数秒）
  locked_until timestamptz,
  created_by uuid REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, kind)
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES offices(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  recording_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'succeeded', 'partial', 'failed')),
  step text,
  -- 段ごとの結果・時間・トークン・費用（中身は入れない。大きい結果は作業用の置き場）
  steps jsonb NOT NULL DEFAULT '{}'::jsonb,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  error_kind text,
  batch_id uuid,
  eta_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recording_id)
);
-- 同じ書類で処理中のジョブは 1 つだけ
CREATE UNIQUE INDEX jobs_one_processing ON jobs (document_id) WHERE status = 'processing';

-- 書き込み（1 回の録音・書類の写しで AI が用紙を変えたまとまり）
CREATE TABLE batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES offices(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  kind text NOT NULL CHECK (kind IN ('recording', 'copy', 'seed')),
  label text NOT NULL,
  job_id uuid REFERENCES jobs(id),
  -- [{key, op: add|update, before, after, cite}]
  changes jsonb NOT NULL,
  -- [{key, reason: 'cm'}] 新しい話があったが、ケアマネの欄なので書き換えなかった欄
  kept jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 今の値（3 層目のシート）。基本情報の欄は document_id が NULL（利用者に 1 つ）
CREATE TABLE field_values (
  id bigserial PRIMARY KEY,
  office_id uuid NOT NULL REFERENCES offices(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  document_id uuid REFERENCES documents(id),
  key text NOT NULL,
  value jsonb NOT NULL,
  -- 最後に AI が書いた値（差分の「直した文」の見分けに使う）
  ai_value jsonb,
  by text NOT NULL CHECK (by IN ('ai', 'cm')),
  batch_id uuid REFERENCES batches(id),
  cite jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES staff(id),
  CONSTRAINT field_values_unique UNIQUE NULLS NOT DISTINCT (client_id, document_id, key)
);
CREATE INDEX field_values_doc ON field_values (document_id);

-- 前の値（追記だけ）
CREATE TABLE field_history (
  id bigserial PRIMARY KEY,
  office_id uuid NOT NULL REFERENCES offices(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  document_id uuid REFERENCES documents(id),
  key text NOT NULL,
  value jsonb,
  by text,
  batch_id uuid,
  changed_by uuid REFERENCES staff(id),
  at timestamptz NOT NULL DEFAULT now()
);

-- その書類で保存した値（印は「今の値」と「保存した値」の違いで出す）
CREATE TABLE document_saved (
  document_id uuid NOT NULL REFERENCES documents(id),
  key text NOT NULL,
  value jsonb NOT NULL,
  by text NOT NULL CHECK (by IN ('ai', 'cm')),
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, key)
);

-- 版（保存のたびに、保存した値の全部を残す。書き換えない）。PDF は最新の版から作る
CREATE TABLE revisions (
  id bigserial PRIMARY KEY,
  office_id uuid NOT NULL REFERENCES offices(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  rev integer NOT NULL,
  scope text NOT NULL CHECK (scope IN ('hunk', 'page', 'document')),
  -- 保存したときの様式の版（PDF はこの版から作る）
  template_version_id uuid NOT NULL REFERENCES form_template_versions(id),
  "values" jsonb NOT NULL,
  saved_by uuid REFERENCES staff(id),
  saved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, rev)
);

CREATE TABLE recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES offices(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  object_path text NOT NULL,
  mime text NOT NULL,
  bytes bigint,
  duration_ms integer,
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'uploaded', 'failed')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 原本（文字起こし）。発言ごとの id・時刻・話者・人・文
CREATE TABLE transcripts (
  recording_id uuid PRIMARY KEY REFERENCES recordings(id),
  office_id uuid NOT NULL REFERENCES offices(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  utterances jsonb NOT NULL,
  speakers jsonb NOT NULL DEFAULT '{}'::jsonb,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES offices(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  revision_rev integer,
  template_version_id uuid REFERENCES form_template_versions(id),
  object_path text,
  created_by uuid REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 操作の記録（追記だけ）。中身（欄の値・話の内容）は入れない
CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  office_id uuid NOT NULL REFERENCES offices(id),
  staff_id uuid REFERENCES staff(id),
  client_id uuid REFERENCES clients(id),
  document_id uuid REFERENCES documents(id),
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_office ON audit_events (office_id, at DESC);
