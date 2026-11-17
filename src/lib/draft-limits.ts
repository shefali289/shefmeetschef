/** Recipe field limits shared by the Gemini parser, the draft form and the server validation. */
export const DRAFT_LIMITS = {
  title: 200,
  description: 2000,
  unit: 40,
  item: 200,
  note: 200,
  step: 2000,
  ingredients: 60,
  steps: 40,
  minutes: 1440,
} as const;
