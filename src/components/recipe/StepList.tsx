import type { Step } from "@/lib/types";

export default function StepList({ steps }: { steps: Step[] }) {
  return (
    <section aria-labelledby="steps-heading">
      <h2 id="steps-heading" className="text-3xl font-extrabold">
        <span className="brush">Steps</span>
      </h2>
      <ol className="mt-5 space-y-4">
        {steps.map((step, i) => (
          <li
            key={i}
            className="flex items-start gap-4 rounded-[1.5rem] bg-white p-4 shadow-soft ring-1 ring-cocoa/10 sm:p-5"
          >
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-blush-light font-hand text-3xl leading-none font-bold text-copper-dark"
            >
              {i + 1}
            </span>
            <p className="pt-2 leading-relaxed">{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
