-- The weekly weight question was removed from the product. It was the only
-- question in WEEKLY_CHECKIN, so disable the template as well; otherwise the
-- scheduler/client could expose an empty questionnaire.

DELETE FROM pdlife.template_questions
WHERE template_code = 'WEEKLY_CHECKIN'
  AND question_code = 'OTHER_WEIGHT_WEEKLY';

UPDATE pdlife.checkin_templates
SET active = FALSE
WHERE template_code = 'WEEKLY_CHECKIN';

-- Keep the question row and historical responses for clinical/audit history,
-- but prevent it from being selected for any new questionnaire.
UPDATE pdlife.question_bank
SET active = FALSE,
    updated_at = now()
WHERE question_code = 'OTHER_WEIGHT_WEEKLY';

-- Remove unfinished cards that were already generated. Completed rounds and
-- their answers remain untouched.
UPDATE pdlife.round_instances
SET status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM pdlife.responses r
        WHERE r.round_instance_id = round_instances.id
      ) THEN 'expired'::pdlife.round_status
      ELSE 'missed'::pdlife.round_status
    END,
    expires_at = LEAST(COALESCE(expires_at, now()), now())
WHERE template_code = 'WEEKLY_CHECKIN'
  AND status = 'pending';
