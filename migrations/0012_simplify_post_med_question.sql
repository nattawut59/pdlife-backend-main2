-- POST_MED_MICRO is intentionally a single, one-tap state question.
-- Historical question-bank rows and responses are retained for audit/history.

DELETE FROM pdlife.template_questions
WHERE template_code = 'POST_MED_MICRO'
  AND question_code IN ('MED_ADHERENCE', 'MED_DYSKINESIA_NOW');

UPDATE pdlife.question_bank
SET question_full_th = 'ตอนนี้ยาออกฤทธิ์ดีอยู่ไหม?',
    options_json = '[
      {"code":"state_off","label":"OFF — ยาไม่ออกฤทธิ์ อาการพาร์กินสันเด่น","score":null},
      {"code":"state_on","label":"ON — ยาออกฤทธิ์ เคลื่อนไหวได้ดี","score":null},
      {"code":"state_dyskinesia","label":"Dyskinesia/ยุกยิก","score":null}
    ]'::jsonb,
    version = version + 1,
    updated_at = now()
WHERE question_code = 'MED_ONOFF_NOW';

UPDATE pdlife.checkin_templates
SET max_questions_target = 1
WHERE template_code = 'POST_MED_MICRO';
