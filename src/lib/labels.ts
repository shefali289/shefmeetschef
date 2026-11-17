/** Human label for an allow-listed value: "gluten-free" -> "Gluten free", "tree-nuts" -> "Tree nuts". */
export function humanLabel(value: string): string {
  const words = value.replace(/-/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
