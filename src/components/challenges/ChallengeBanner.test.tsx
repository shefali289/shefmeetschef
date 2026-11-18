import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ChallengeBanner, { type ChallengeBannerProps } from "./ChallengeBanner";

/*
 * Contract: <ChallengeBanner challenge today onBaseRecipe? /> (server-safe, no client hooks needed).
 * - A region (section) labelled by its "This week's remix challenge" heading/kicker.
 * - Shows the challenge title, the hashtag #ShefMeetsChefRemix and daysLeftText(today, endsOn).
 * - Links to /challenges/<id>.
 * - Not on the base recipe: links to the base recipe page /recipes/<slug> (when it has one).
 * - On the base recipe (onBaseRecipe): links to /recipes/<slug>/remix ("Remix this").
 * - Links are at least 44px tall. Decoration respects reduced motion (no JS animation).
 */

const CHALLENGE: ChallengeBannerProps["challenge"] = {
  id: "c2c2c2c2-0000-4000-8000-000000000002",
  title: "Chai, your way",
  endsOn: "2026-11-21",
  baseRecipeSlug: "masala-chai",
  baseRecipeTitle: "Masala Chai",
};

const TARGET_44 = /(^|\s)(min-h|h|size)-(1[1-9]|[2-9]\d)(\s|$)/;
const banner = () => screen.getByRole("region", { name: /this week['’]s remix challenge/i });

describe("ChallengeBanner", () => {
  it("shows This week's remix challenge, the title, #ShefMeetsChefRemix and 3 days left", () => {
    render(<ChallengeBanner challenge={CHALLENGE} today="2026-11-18" />);
    const region = banner();
    expect(within(region).getByText(/this week['’]s remix challenge/i)).toBeInTheDocument();
    expect(within(region).getByText("Chai, your way")).toBeInTheDocument();
    expect(within(region).getByText(/#ShefMeetsChefRemix/)).toBeInTheDocument();
    expect(within(region).getByText(/3 days left/)).toBeInTheDocument();
  });

  it("counts down to 1 day left and Last day today", () => {
    const { unmount } = render(<ChallengeBanner challenge={CHALLENGE} today="2026-11-20" />);
    expect(within(banner()).getByText(/1 day left/)).toBeInTheDocument();
    unmount();
    render(<ChallengeBanner challenge={CHALLENGE} today="2026-11-21" />);
    expect(within(banner()).getByText(/last day today/i)).toBeInTheDocument();
  });

  it("links to the challenge page", () => {
    render(<ChallengeBanner challenge={CHALLENGE} today="2026-11-18" />);
    const links = within(banner()).getAllByRole("link");
    const toChallenge = links.find((a) => a.getAttribute("href") === `/challenges/${CHALLENGE.id}`);
    expect(toChallenge).toBeDefined();
    expect(toChallenge!).toHaveAccessibleName(/.+/);
    expect(toChallenge!.className).toMatch(TARGET_44);
    // off the base recipe page it points at the recipe to remix
    expect(links.some((a) => a.getAttribute("href") === "/recipes/masala-chai")).toBe(true);
    expect(links.some((a) => a.getAttribute("href") === "/recipes/masala-chai/remix")).toBe(false);
  });

  it("on the base recipe it links to Remix this", () => {
    render(<ChallengeBanner challenge={CHALLENGE} today="2026-11-18" onBaseRecipe />);
    const remix = within(banner()).getByRole("link", { name: /remix this/i });
    expect(remix).toHaveAttribute("href", "/recipes/masala-chai/remix");
    expect(remix.className).toMatch(TARGET_44);
  });

  it("the title is plain text, not HTML", () => {
    render(<ChallengeBanner challenge={{ ...CHALLENGE, title: "<img src=x onerror=alert(1)>" }} today="2026-11-18" />);
    expect(within(banner()).getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });

  it("a challenge whose base recipe is no longer live still links to its page", () => {
    render(<ChallengeBanner challenge={{ ...CHALLENGE, baseRecipeSlug: null, baseRecipeTitle: null }} today="2026-11-18" />);
    const links = within(banner()).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toContain(`/challenges/${CHALLENGE.id}`);
    expect(links.some((a) => (a.getAttribute("href") ?? "").startsWith("/recipes/"))).toBe(false);
  });
});
