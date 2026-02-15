import { z } from "zod";

// ── Audience levels ─────────────────────────────────────────────────────────

export const Audience = {
  young_children: "Young Children (0-8)",
  middle_grade: "Middle Grade (8-12)",
  young_adult: "Young Adult (12-18)",
  adult: "Adult (18+)",
} as const;

export type AudienceKey = keyof typeof Audience;

export const AUDIENCE_KEYS = Object.keys(Audience) as AudienceKey[];

export const AudienceSchema = z.enum([
  "young_children",
  "middle_grade",
  "young_adult",
  "adult",
]);

// ── Topic tags ──────────────────────────────────────────────────────────────

export const Topic = {
  lgbtq_identity: "LGBTQ+ Identity & Relationships",
  gender_identity: "Gender Identity & Expression",
  race_and_racism: "Race, Racism & Racial Justice",
  sex_education: "Sex Education & Sexuality",
  social_justice: "Social Justice & Equity",
  mental_health: "Mental Health & Suicide",
  religious_viewpoints: "Religious Viewpoints & Criticism",
  drug_and_alcohol: "Drugs, Alcohol & Substance Use",
  violence_and_abuse: "Violence, Abuse & Trauma",
  death_and_grief: "Death, Grief & End of Life",
  family_and_divorce: "Family Structures & Divorce",
  body_image: "Body Image & Eating Disorders",
  political_activism: "Political Activism & Protest",
  witchcraft_and_occult: "Witchcraft, Occult & Supernatural",
  profanity_and_language: "Profanity & Explicit Language",
} as const;

export type TopicKey = keyof typeof Topic;

export const TOPIC_KEYS = Object.keys(Topic) as TopicKey[];

export const TopicSchema = z.enum([
  "lgbtq_identity",
  "gender_identity",
  "race_and_racism",
  "sex_education",
  "social_justice",
  "mental_health",
  "religious_viewpoints",
  "drug_and_alcohol",
  "violence_and_abuse",
  "death_and_grief",
  "family_and_divorce",
  "body_image",
  "political_activism",
  "witchcraft_and_occult",
  "profanity_and_language",
]);

// ── Classification result schema ────────────────────────────────────────────

export const ClassificationResultSchema = z.object({
  isbn13: z.string().length(13),
  audience: AudienceSchema,
  topics: z.array(TopicSchema).min(1).max(4),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

export const ClassificationBatchSchema = z.array(ClassificationResultSchema);
