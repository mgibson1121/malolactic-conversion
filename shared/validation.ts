import { z } from 'zod'

// ─── Enum schemas ─────────────────────────────────────────────────────────────

export const WineStatusSchema = z.enum(['discovered', 'wishlist', 'cellar', 'consumed'])
export const CellarCategorySchema = z.enum(['table', 'near_term', 'long_term'])
export const VintageRatingSchema = z.enum(['below_avg', 'avg', 'good', 'very_good'])
export const MyRatingSchema = z.enum(['pass', 'ok', 'good', 'great'])
export const AdviceSourceRoleSchema = z.enum([
  'sommelier',
  'friend',
  'merchant',
  'writer',
  'other',
])
export const AdviceCategorySchema = z.enum([
  'producer',
  'technique',
  'value',
  'region',
  'vintage',
  'other',
])

// ─── Wine entry ───────────────────────────────────────────────────────────────

export const DrinkingWindowSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
})

export const CreateWineSchema = z.object({
  producer: z.string().nullish().transform((v) => v ?? null),
  vintage: z
    .number()
    .int()
    .min(1800)
    .max(new Date().getFullYear() + 1)
    .nullish()
    .transform((v) => v ?? null),
  region: z.string().nullish().transform((v) => v ?? null),
  denomination: z.string().nullish().transform((v) => v ?? null),
  // Tier 2
  quality_classification: z.string().nullish().transform((v) => v ?? null),
  vineyard: z.string().nullish().transform((v) => v ?? null),
  cuvee: z.string().nullish().transform((v) => v ?? null),
  grape_varieties: z.array(z.string()).nullish().transform((v) => v ?? null),
  label_image_url: z.string().url().nullish().transform((v) => v ?? null),
  status: WineStatusSchema.default('discovered'),
  cellar_category: CellarCategorySchema.nullish().transform((v) => v ?? null),
  drinking_window: DrinkingWindowSchema.nullish().transform((v) => v ?? null),
  vintage_rating: VintageRatingSchema.nullish().transform((v) => v ?? null),
  my_rating: MyRatingSchema.nullish().transform((v) => v ?? null),
  my_tags: z.array(z.string()).default([]),
  wishlist_notes: z.string().nullish().transform((v) => v ?? null),
  price_paid: z.number().positive().nullish().transform((v) => v ?? null),
  purchased_from: z.string().nullish().transform((v) => v ?? null),
  date_consumed: z.string().nullish().transform((v) => v ?? null),
})

export const UpdateWineSchema = CreateWineSchema.partial()

export const PromoteWineSchema = z.object({
  status: WineStatusSchema,
})

// ─── Tasting note ─────────────────────────────────────────────────────────────

export const TastingClaritySchema = z.enum(['clear', 'hazy'])
export const TastingColourIntensitySchema = z.enum(['pale', 'medium', 'deep'])
export const TastingNoseConditionSchema = z.enum(['clean', 'unclean'])
export const TastingIntensitySchema = z.enum(['light', 'medium', 'medium_plus', 'pronounced'])
export const TastingSweetnessSchema = z.enum([
  'dry',
  'off_dry',
  'medium_dry',
  'medium',
  'medium_sweet',
  'sweet',
  'luscious',
])
export const TastingAciditySchema = z.enum([
  'low',
  'medium_minus',
  'medium',
  'medium_plus',
  'high',
])
export const TastingTanninSchema = z.enum([
  'low',
  'medium_minus',
  'medium',
  'medium_plus',
  'high',
])
export const TastingBodySchema = z.enum(['light', 'medium', 'full'])
export const TastingFinishSchema = z.enum(['short', 'medium', 'long'])
export const TastingQualitySchema = z.enum([
  'flawed',
  'poor',
  'acceptable',
  'good',
  'very_good',
  'outstanding',
])

export const CreateTastingNoteSchema = z.object({
  wine_id: z.string().uuid(),
  tasted_at: z.string().datetime({ offset: true }).default(() => new Date().toISOString()),
  clarity: TastingClaritySchema.nullish().transform((v) => v ?? null),
  colour_intensity: TastingColourIntensitySchema.nullish().transform((v) => v ?? null),
  colour: z.string().nullish().transform((v) => v ?? null),
  nose_condition: TastingNoseConditionSchema.nullish().transform((v) => v ?? null),
  nose_intensity: TastingIntensitySchema.nullish().transform((v) => v ?? null),
  nose_primary_aromas: z.array(z.string()).default([]),
  nose_secondary_aromas: z.array(z.string()).default([]),
  nose_tertiary_aromas: z.array(z.string()).default([]),
  palate_sweetness: TastingSweetnessSchema.nullish().transform((v) => v ?? null),
  palate_acidity: TastingAciditySchema.nullish().transform((v) => v ?? null),
  palate_tannin: TastingTanninSchema.nullish().transform((v) => v ?? null),
  palate_body: TastingBodySchema.nullish().transform((v) => v ?? null),
  palate_flavour_intensity: TastingIntensitySchema.nullish().transform((v) => v ?? null),
  palate_finish: TastingFinishSchema.nullish().transform((v) => v ?? null),
  quality_assessment: TastingQualitySchema.nullish().transform((v) => v ?? null),
  my_rating: MyRatingSchema.nullish().transform((v) => v ?? null),
  free_text: z.string().nullish().transform((v) => v ?? null),
  tags: z.array(z.string()).default([]),
})

// ─── Advice ───────────────────────────────────────────────────────────────────

export const CreateAdviceSchema = z.object({
  wine_id: z.string().uuid().nullish().transform((v) => v ?? null),
  source_name: z.string().min(1),
  source_role: AdviceSourceRoleSchema,
  category: AdviceCategorySchema,
  content: z.string().min(1),
  captured_at: z.string().datetime({ offset: true }).default(() => new Date().toISOString()),
})

// ─── Cellar entry ─────────────────────────────────────────────────────────────

export const UpsertCellarSchema = z.object({
  quantity: z.number().int().min(0),
  location_notes: z.string().nullish().transform((v) => v ?? null),
  date_acquired: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .transform((v) => v ?? null),
  price_paid: z.number().positive().nullish().transform((v) => v ?? null),
  purchased_from: z.string().nullish().transform((v) => v ?? null),
})

// ─── Wishlist entry ───────────────────────────────────────────────────────────

export const UpsertWishlistSchema = z.object({
  wishlist_notes: z.string().nullish().transform((v) => v ?? null),
  priority: z.number().int().positive().nullish().transform((v) => v ?? null),
})
