import type { Step } from "@/lib/types";

export default function StepList({ steps }: { steps: Step[] }) {
  return (
    <section aria-labelledby="steps-heading">
      <h2 id="steps-heading" className="text-2xl font-bold">
        Steps
      </h2>
      <ol className="mt-4 space-y-4">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-shef-orange font-bold text-white"
            >
              {i + 1}
            </span>
            <p className="pt-1">{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
