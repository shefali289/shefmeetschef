import { humanLabel } from "@/lib/labels";

const REMINDER = "Always check labels if you have an allergy.";


export default function AllergenBox({ allergens }: { allergens: string[] }) {
  return (
    <section aria-label="Allergens" className="rounded-xl border-2 border-spice bg-white p-4">
      {allergens.length > 0 && (
        <>
          <h2 className="text-lg font-bold">Contains</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {allergens.map((a) => (
              <li key={a} className="rounded-full bg-shef-cream px-3 py-1 text-sm font-semibold">
                {humanLabel(a)}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className={allergens.length > 0 ? "mt-3 text-sm" : "text-sm"}>{REMINDER}</p>
    </section>
  );
}
