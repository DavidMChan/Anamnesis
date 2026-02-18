-- Add vuid column to backstories for external data matching
-- Update demographic_keys to match JSONL demographic dimensions

-- 1. Add vuid column
ALTER TABLE backstories ADD COLUMN vuid TEXT;
CREATE UNIQUE INDEX idx_backstories_vuid ON backstories(vuid) WHERE vuid IS NOT NULL;

-- 2. Replace demographic_keys with JSONL dimensions
DELETE FROM demographic_keys;

INSERT INTO demographic_keys (key, display_name, value_type, enum_values) VALUES
    ('c_age', 'Age', 'enum', '["18-24", "25-34", "35-44", "45-54", "55-64", "65+", "Prefer not to answer"]'),
    ('c_gender', 'Gender', 'enum', '["Male", "Female", "Other (e.g., non-binary, trans)", "Prefer not to answer"]'),
    ('c_education', 'Education Level', 'enum', '["Less than high school", "High school graduate or equivalent (e.g., GED)", "Some college, but no degree", "Associate degree", "Bachelor''s degree", "Professional degree (e.g., JD, MD)", "Master''s degree", "Doctoral degree", "Prefer not to answer"]'),
    ('c_income', 'Annual Income', 'enum', '["Less than $10,000", "$10,000 to $19,999", "$20,000 to $29,999", "$30,000 to $39,999", "$40,000 to $49,999", "$50,000 to $59,999", "$60,000 to $69,999", "$70,000 to $79,999", "$80,000 to $89,999", "$90,000 to $99,999", "$100,000 to $149,999", "$150,000 to $199,999", "$200,000 or more", "Prefer not to answer"]'),
    ('c_race', 'Race/Ethnicity', 'enum', '["American Indian or Alaska Native", "Asian or Asian American", "Black or African American", "Hispanic or Latino/a", "Middle Eastern or North African", "Native Hawaiian or Other Pacific Islander", "White or European", "Other", "Prefer not to answer"]'),
    ('c_religion', 'Religion', 'enum', '["Protestant", "Roman Catholic", "Mormon (Church of Jesus Christ of Latter-day Saints or LDS)", "Orthodox (such as Greek, Russian, or some other Orthodox church)", "Jewish", "Muslim", "Buddhist", "Hindu", "Atheist", "Agnostic", "Other", "Nothing in particular", "Prefer not to answer"]'),
    ('c_region', 'Region', 'enum', '["Northeast", "Midwest", "South", "West", "I do not live in the U.S.", "Prefer not to answer"]'),
    ('c_party', 'Political Party', 'enum', '["Democrat", "Republican", "Independent", "Other", "No preference"]'),
    ('c_democratic_strength', 'Democratic Strength', 'enum', '["Strong Democrat", "Not very strong Democrat"]'),
    ('c_republican_strength', 'Republican Strength', 'enum', '["Strong Republican", "Not very strong Republican"]'),
    ('c_independent_leaning', 'Independent Leaning', 'enum', '["Closer to Republican", "Neither", "Closer to Democrat"]');
