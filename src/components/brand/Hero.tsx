import Image from "next/image";
import Link from "next/link";
import { INSTAGRAM_URL } from "@/lib/social";
import HerbSprig from "./HerbSprig";
import { InstagramIcon } from "./SocialIcons";
import { Heart } from "./Wordmark";

const button =
  "press inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 py-2 font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cocoa";

export default function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="relative overflow-hidden px-4 pt-6 pb-16 sm:pt-12">
      {/* Soft sunlight blobs behind the hero. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-16 -right-20 h-72 w-72 rounded-full bg-peach/80 blur-3xl" />
        <div className="absolute top-1/2 -left-24 h-64 w-64 rounded-full bg-blush-light blur-3xl" />
      </div>

      <div className="mx-auto grid max-w-5xl items-center gap-12 md:grid-cols-[1.05fr_1fr] md:gap-10">
        <div className="animate-fade-up text-center md:text-left" style={{ "--delay": "120ms" } as React.CSSProperties}>
          <p className="font-hand text-2xl text-herb">hello from my kitchen!</p>
          <h1 id="hero-heading" className="mt-1 text-[2.75rem] leading-[1.05] font-extrabold tracking-tight text-cocoa sm:text-6xl">
            Hi, I&rsquo;m <span className="brush">Shef</span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-lg text-cocoa-soft md:mx-0">
            Raw plates, honest bites &amp; foodie experiments
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center md:justify-start">
            <Link
              href="/recipes"
              className={`${button} bg-copper text-white shadow-soft hover:bg-copper-dark hover:shadow-lift`}
            >
              Browse recipes
            </Link>
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${button} border-2 border-copper bg-white/80 text-cocoa hover:bg-blush-light`}
            >
              <InstagramIcon />
              Follow @shefmeetschef<span className="sr-only"> (opens in new tab)</span>
            </a>
          </div>
          <p aria-hidden="true" className="mt-6 font-hand text-xl text-cocoa-soft">
            cook &middot; create &middot; eat &middot; repeat
          </p>
        </div>

        <div className="relative order-first mx-auto w-full max-w-[22rem] md:order-none md:max-w-md">
          <HerbSprig className="absolute -top-5 -right-3 z-10 h-14 w-14 rotate-12" />
          <div className="animate-scale-in overflow-hidden rounded-[2.5rem] bg-peach shadow-lift ring-8 ring-white">
            <Image
              src="/brand/shef-cooking.webp"
              alt="Shef cooking in her sunlit kitchen, smiling over a pan of vegetables"
              width={1200}
              height={1200}
              priority
              sizes="(min-width: 1024px) 28rem, (min-width: 768px) 45vw, 100vw"
              className="aspect-square h-auto w-full object-cover"
            />
          </div>
          <div className="absolute -top-4 -left-3 z-10 overflow-hidden rounded-full shadow-soft ring-4 ring-white">
            <Image
              src="/brand/shef-avatar-cooking.webp"
              alt=""
              width={72}
              height={72}
              sizes="72px"
              className="size-16 scale-110 object-cover sm:size-[4.5rem]"
            />
          </div>
          <p
            className="animate-float absolute -bottom-7 left-1/2 flex w-max max-w-[17rem] -translate-x-1/2 items-center gap-2 rounded-2xl bg-white px-4 py-2 font-hand text-xl leading-tight text-cocoa shadow-soft md:-left-6 md:translate-x-0"
            style={{ "--tilt": "-3deg" } as React.CSSProperties}
          >
            for more easy, delicious &amp; fun recipes!
            <Heart className="h-3.5 w-3.5 text-copper" />
          </p>
        </div>
      </div>
    </section>
  );
}
