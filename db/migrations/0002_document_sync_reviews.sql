-- 別書類への反映・維持を判断した時点の元書類の値。
CREATE TABLE document_sync_reviews (
  office_id uuid NOT NULL REFERENCES offices(id),
  source_document_id uuid NOT NULL REFERENCES documents(id),
  target_document_id uuid NOT NULL REFERENCES documents(id),
  key text NOT NULL,
  source_value jsonb,
  reviewed_by uuid NOT NULL REFERENCES staff(id),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_document_id, target_document_id, key),
  CHECK (source_document_id <> target_document_id)
);
CREATE INDEX document_sync_reviews_target ON document_sync_reviews (target_document_id);
