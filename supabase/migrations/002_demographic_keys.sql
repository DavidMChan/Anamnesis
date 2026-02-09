-- Add demographic_keys table to track demographic types and their value types

CREATE TABLE demographic_keys (
    key             TEXT PRIMARY KEY,      -- "age", "gender", "income"
    display_name    TEXT NOT NULL,         -- "Age", "Gender", "Annual Income"
    value_type      TEXT NOT NULL CHECK (value_type IN ('numeric', 'enum', 'text')),
    enum_values     JSONB,                 -- ["male", "female", ...] for enums only
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with common demographics
INSERT INTO demographic_keys (key, display_name, value_type, enum_values) VALUES
    ('age', 'Age', 'numeric', NULL),
    ('gender', 'Gender', 'enum', '["male", "female", "non-binary", "other"]'),
    ('party', 'Political Party', 'enum', '["democrat", "republican", "independent", "other"]'),
    ('education', 'Education Level', 'enum', '["high_school", "some_college", "bachelors", "masters", "doctorate"]'),
    ('income', 'Annual Income', 'numeric', NULL),
    ('race', 'Race/Ethnicity', 'enum', '["white", "black", "hispanic", "asian", "other"]'),
    ('religion', 'Religion', 'enum', '["christian", "jewish", "muslim", "hindu", "buddhist", "atheist", "other"]'),
    ('region', 'Region', 'enum', '["northeast", "midwest", "south", "west"]');

-- Allow all authenticated users to read demographic_keys
ALTER TABLE demographic_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view demographic keys" ON demographic_keys
    FOR SELECT USING (true);

-- Only allow inserts via service role (backend) for now
-- Users can request custom demographics through the app
