BEGIN;

-- activity_date is the patient's Bangkok calendar date. It is deliberately separate from
-- TIMESTAMPTZ so a 00:30 Bangkok activity does not become "yesterday" when queried in UTC.
ALTER TABLE pdlife.medication_logs
  ADD COLUMN activity_date DATE,
  ADD COLUMN idempotency_key VARCHAR;

UPDATE pdlife.medication_logs
SET activity_date = (planned_at AT TIME ZONE 'Asia/Bangkok')::date
WHERE activity_date IS NULL;

ALTER TABLE pdlife.medication_logs ALTER COLUMN activity_date SET NOT NULL;

-- Preserve every historical dose, but claim each logical dose key for only
-- one row. A completed dose wins over a stale pending duplicate. This stops
-- the first scheduler tick after deployment from re-inserting old doses.
WITH ranked AS (
  SELECT id,
         'med:' || prescription_id::text || ':' ||
           to_char(planned_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS key,
         row_number() OVER (
           PARTITION BY prescription_id, planned_at
           ORDER BY CASE status WHEN 'taken' THEN 3 WHEN 'skipped' THEN 2 ELSE 1 END DESC,
                    received_at DESC NULLS LAST, id
         ) AS position
  FROM pdlife.medication_logs
)
UPDATE pdlife.medication_logs AS log
SET idempotency_key = ranked.key
FROM ranked
WHERE log.id = ranked.id AND ranked.position = 1;

CREATE INDEX idx_med_logs_patient_activity_date
  ON pdlife.medication_logs (patient_id, activity_date, planned_at);
CREATE UNIQUE INDEX idx_med_logs_idempotency
  ON pdlife.medication_logs (idempotency_key);

ALTER TABLE pdlife.round_instances
  ADD COLUMN activity_date DATE,
  ADD COLUMN available_at TIMESTAMPTZ,
  ADD COLUMN due_at TIMESTAMPTZ,
  ADD COLUMN idempotency_key VARCHAR;

UPDATE pdlife.round_instances
SET activity_date = (scheduled_at AT TIME ZONE 'Asia/Bangkok')::date,
    available_at = scheduled_at
WHERE activity_date IS NULL OR available_at IS NULL;

ALTER TABLE pdlife.round_instances ALTER COLUMN activity_date SET NOT NULL;
ALTER TABLE pdlife.round_instances ALTER COLUMN available_at SET NOT NULL;

-- Same principle for scheduled rounds: keep clinical responses on every old
-- row, but reserve the scheduler key on the best representative only.
WITH keyed AS (
  SELECT id, status, created_at,
    CASE template_code
      WHEN 'POST_MED_MICRO' THEN
        CASE WHEN medication_log_id IS NOT NULL THEN 'round:post-med:' || medication_log_id::text END
      WHEN 'PRE_NEXT_MED_MICRO' THEN
        CASE WHEN target_dose_at IS NOT NULL THEN
          'round:pre-next:' || patient_id::text || ':' ||
          to_char(target_dose_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
      WHEN 'MORNING_CHECKIN' THEN 'round:morning:' || patient_id::text || ':' || activity_date::text
      WHEN 'EVENING_DAILY_CORE' THEN 'round:evening:' || patient_id::text || ':' || activity_date::text
      WHEN 'WEEKLY_CHECKIN' THEN 'round:weekly:' || patient_id::text || ':' || activity_date::text
      WHEN 'PREVISIT_7D_FORM' THEN
        CASE WHEN appointment_id IS NOT NULL THEN 'round:previsit:' || appointment_id::text END
      ELSE NULL
    END AS key
  FROM pdlife.round_instances
), ranked AS (
  SELECT id, key,
         row_number() OVER (
           PARTITION BY key
           ORDER BY CASE status WHEN 'completed' THEN 4 WHEN 'pending' THEN 3
                                WHEN 'expired' THEN 2 ELSE 1 END DESC,
                    created_at DESC NULLS LAST, id
         ) AS position
  FROM keyed
  WHERE key IS NOT NULL
)
UPDATE pdlife.round_instances AS ri
SET idempotency_key = ranked.key
FROM ranked
WHERE ri.id = ranked.id AND ranked.position = 1;

CREATE INDEX idx_rounds_patient_activity_date
  ON pdlife.round_instances (patient_id, activity_date, available_at);
CREATE INDEX idx_rounds_patient_actionable
  ON pdlife.round_instances (patient_id, available_at, expires_at)
  WHERE status = 'pending';
CREATE UNIQUE INDEX idx_rounds_idempotency
  ON pdlife.round_instances (idempotency_key);

COMMIT;
