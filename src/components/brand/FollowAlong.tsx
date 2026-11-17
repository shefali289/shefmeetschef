import Image from "next/image";
import Reveal from "@/components/motion/Reveal";
import FollowButtons from "./FollowButtons";

export default function FollowAlong() {
  return (
    <section aria-labelledby="follow-heading" className="px-4 py-16">
      <div className="mx-auto grid max-w-5xl items-center gap-10 md:grid-cols-[1.1fr_0.9fr]">
        <Reveal className="text-center md:order-last md:text-left">
          <p className="font-hand text-2xl text-herb">come cook with me</p>
          <h2 id="follow-heading" className="mt-1 text-3xl font-extrabold text-cocoa">
            <span className="brush">Follow along</span>
          </h2>
          <p className="mx-auto mt-4 max-w-md text-lg text-cocoa md:mx-0">
            New reels most weeks: quick weeknight dinners, chai experiments and the odd kitchen fail.
          </p>
          <FollowButtons className="mt-6 justify-center md:justify-start" />
        </Reveal>
        <Reveal delay={120} className="mx-auto w-full max-w-[15rem] sm:max-w-[17rem]">
          <div className="-rotate-2 overflow-hidden rounded-[2rem] bg-peach shadow-lift ring-8 ring-white">
            <Image
              src="/brand/follow-card.webp"
              alt="Follow shefmeetschef for more easy, delicious and fun recipes!"
              width={941}
              height={1672}
              sizes="(min-width: 640px) 17rem, 15rem"
              className="h-auto w-full"
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
