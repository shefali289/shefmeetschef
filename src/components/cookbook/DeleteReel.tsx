"use client";
import { deleteReel } from "@/app/cookbook/reel-actions";
import ConfirmDelete from "./ConfirmDelete";
import { REELS_HEADING_ID } from "./ids";


/** Lets an owner delete their own outside reel recipe, after an inline confirmation. */
export default function DeleteReel({ recipeId, title }: { recipeId: string; title: string }) {
  return (
    <ConfirmDelete
      label={`Delete ${title}`}
      message={`Delete ${title}? Deleting it won't give you the reel back this month.`}
      fields={{ recipe_id: recipeId }}
      action={deleteReel}
      successMessage="Reel deleted"
      focusAfterId={REELS_HEADING_ID}
    />
  );
}
