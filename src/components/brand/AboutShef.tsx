import HerbSprig from "./HerbSprig";

export default function AboutShef() {
  return (
    <section aria-labelledby="about-heading" className="bg-herb-light px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <h2 id="about-heading" className="flex items-center gap-2 text-2xl font-bold text-shef-navy">
          <HerbSprig className="h-8 w-8" />
          About Shef
        </h2>
        <p className="mt-4 text-lg text-shef-navy">
          Very raw, unfiltered homemade food, no fancy plating. I&rsquo;m a home cook in New Zealand
          sharing the Indian, fusion and everyday dishes I actually make for my family and friends,
          plus the odd foodie experiment that turns out better than expected.
        </p>
      </div>
    </section>
  );
}
