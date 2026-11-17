"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from "react";

export type RevealProps = Omit<HTMLAttributes<HTMLElement>, "style"> & {
  as?: ElementType;
  /** Stagger delay in milliseconds. */
  delay?: number;
  className?: string;
  children?: ReactNode;
};

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Phase = "idle" | "pending" | "revealed";

/**
 * Fades and slides its children up the first time they scroll into view.
 * Never hidden in the server render: only elements found below the fold after mount are marked
 * `data-reveal="pending"` (hidden by globals.css, with a CSS fallback that shows them anyway).
 * Revealed at once above the fold, with reduced motion, or without IntersectionObserver.
 */
export default function Reveal({ as: Tag = "div", delay = 0, className, children, ...rest }: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const belowFold = el.getBoundingClientRect().top > window.innerHeight;
    if (!belowFold || typeof IntersectionObserver !== "function" || prefersReducedMotion()) {
      setPhase("revealed");
      return;
    }
    setPhase("pending");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPhase("revealed");
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const style = delay ? ({ "--reveal-delay": `${delay}ms` } as CSSProperties) : undefined;

  return (
    <Tag
      {...rest}
      ref={ref}
      data-reveal={phase === "pending" ? "pending" : ""}
      data-revealed={phase === "revealed" ? "true" : undefined}
      className={className}
      style={style}
    >
      {children}
    </Tag>
  );
}
