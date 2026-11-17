import { humanLabel } from "@/lib/labels";

const TAG_CLASSES: Record<string, string> = {
  vegetarian: "bg-herb-light text-shef-navy border-herb",
  vegan: "bg-herb text-white border-herb",
  halal: "bg-shef-cream text-spice border-spice",
  "gluten-free": "bg-white text-shef-navy border-shef-orange",
};

export default function DietTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <ul aria-label="Diet" className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <li key={tag}>
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${
              TAG_CLASSES[tag] ?? "bg-white text-shef-navy border-shef-navy"
            }`}
          >
            {humanLabel(tag)}
          </span>
        </li>
      ))}
    </ul>
  );
}
