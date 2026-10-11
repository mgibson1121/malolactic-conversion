-- Phase 12.2 (WI-2.5): the developer's answer to "Which bottling is yours?".
--
-- bottling_plain: 1 when the answer was "Plain / no special bottling", so a
-- later refresh does not ask again. NULL = never answered.
-- bottling_prompt_dismissed: the modifier signature of the last prompt that
-- was answered or dismissed ("Not sure"), the prompt is raised again only for a
-- different set of modifiers.
--
-- The vineyard / cuvée answer itself is written to the existing `vineyard` /
-- `cuvee` columns. Nothing automated ever writes these two.

ALTER TABLE wines ADD COLUMN bottling_plain INTEGER;
ALTER TABLE wines ADD COLUMN bottling_prompt_dismissed TEXT;
