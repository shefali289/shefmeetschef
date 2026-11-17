import { humanLabel } from "@/lib/labels";

const REMINDER = "Always check labels if you have an allergy.";


export default function AllergenBox({ allergens }: { allergens: string[] }) {
  return (
    <section aria-label="Allergens" className="rounded-[1.5rem] border-2 border-dashed border-spice/70 bg-peach-light p-5">
      {allergens.length > 0 && (
        <>
          <h2 className="text-lg font-bold">Contains</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {allergens.map((a) => (
              <li key={a} className="rounded-full bg-white px-3 py-1 ring-1 ring-spice/40 text-sm font-semibold">
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
