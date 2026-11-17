import Image from "next/image";
import Reveal from "@/components/motion/Reveal";
import HerbSprig from "./HerbSprig";

export default function AboutShef() {
  return (
    <section
      aria-labelledby="about-heading"
      className="relative overflow-hidden bg-gradient-to-b from-peach-light to-blush-light/60 px-4 py-16"
    >
      <div className="mx-auto grid max-w-5xl items-center gap-10 md:grid-cols-[0.9fr_1.1fr]">
        <Reveal className="relative mx-auto w-full max-w-xs">
          <div className="overflow-hidden rounded-[2rem] bg-peach shadow-lift ring-8 ring-white">
            <Image
              src="/brand/shef-presenting.webp"
              alt="Shef in her apron, presenting a table of freshly cooked dishes"
              width={941}
              height={1672}
              sizes="(min-width: 768px) 20rem, 80vw"
              className="aspect-[4/5] h-auto w-full object-cover object-[50%_35%]"
            />
          </div>
        </Reveal>

        <Reveal delay={120}>
          <p className="font-hand text-2xl text-herb">a little about me</p>
          <h2 id="about-heading" className="mt-1 flex items-center gap-2 text-3xl font-extrabold text-cocoa">
            <span className="brush">About Shef</span>
            <HerbSprig className="h-9 w-9" />
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-cocoa">
            Very raw, unfiltered homemade food, no fancy plating. I&rsquo;m a home cook in New Zealand
            sharing the Indian, fusion and everyday dishes I actually make for my family and friends,
            plus the odd foodie experiment that turns out better than expected.
          </p>
          <p aria-hidden="true" className="mt-5 font-hand text-2xl text-copper-ink">
            cook, create, eat, repeat &hearts;
          </p>
        </Reveal>
      </div>
    </section>
  );
}
