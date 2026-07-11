-- Rich-text variants: for elements whose text is split across styled children
-- (textParts), the analysis also emits each variant split into parts.
-- string[][] — one inner array per variant, one string per text part.
alter table comments
  add column if not exists variant_parts jsonb not null default '[]'::jsonb;
