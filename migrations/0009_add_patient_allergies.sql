BEGIN;

CREATE TABLE pdlife.patient_allergies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES pdlife.users(id) ON DELETE CASCADE,
  substance  VARCHAR(200) NOT NULL,
  created_by UUID NOT NULL REFERENCES pdlife.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (patient_id, substance)
);

CREATE INDEX idx_patient_allergies_patient
  ON pdlife.patient_allergies (patient_id, created_at);

-- Default privileges depend on which role ran 0002. Grant this new table
-- explicitly so the backend's service-role client can use it in every setup.
GRANT ALL PRIVILEGES ON pdlife.patient_allergies TO service_role;

COMMIT;
