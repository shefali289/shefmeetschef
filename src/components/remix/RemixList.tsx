import Reveal from "@/components/motion/Reveal";
import type { OwnRemixCard, RemixCardData } from "@/lib/remix/types";
import RemixCard from "./RemixCard";

export interface RemixListProps {
  remixes: (RemixCardData | OwnRemixCard)[];
  signedIn: boolean;
  returnTo: string;
  /** Owner's view: each card shows its status and a delete button. */
  own?: boolean;
  label: string;
  showRecipe?: boolean;
}

/** A grid of remix cards, in the order given. */
export default function RemixList({ remixes, signedIn, returnTo, own = false, label, showRecipe = true }: RemixListProps) {
  return (
    <ul aria-label={label} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {remixes.map((remix, i) => (
        <Reveal as="li" key={remix.id} delay={Math.min(i, 5) * 60}>
          <RemixCard
            remix={remix}
            signedIn={signedIn}
            returnTo={returnTo}
            showRecipe={showRecipe}
            ownStatus={own && "status" in remix ? remix.status : undefined}
          />
        </Reveal>
      ))}
    </ul>
  );
}
