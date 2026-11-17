/** Allow-listed recipe values. No dependencies, so client components can import it cheaply. */
export const CUISINES = ["indian", "fusion", "italian", "chinese"] as const;
export const CATEGORIES = [
  "healthy",
  "air-fryer",
  "drinks",
  "desserts",
  "festival-specials",
  "kids-and-parties",
] as const;
export const DIET_TAGS = ["vegetarian", "vegan", "halal", "gluten-free"] as const;
/** Australia/NZ (FSANZ) mandatory allergen list. */
export const ALLERGENS = [
  "peanut",
  "tree-nuts",
  "milk",
  "egg",
  "fish",
  "crustacea",
  "mollusc",
  "soy",
  "sesame",
  "wheat",
  "gluten",
  "lupin",
] as const;
