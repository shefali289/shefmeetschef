"use server";
import { z } from "zod";
import { cookbookUser } from "@/app/cookbook/action-auth";
import { fields, firstIssue, uuidField } from "@/app/cookbook/validation";
import { REMIX_NOT_CONFIGURED } from "@/lib/remix/status";
import type { ReportState } from "@/lib/remix/types";
import { returnPath, revalidateRemixes } from "./paths";

/** Longest report reason kept (remix_reports.reason check). */
const REASON_MAX = 300;

const Report = z.object({
  remix_id: uuidField,
  reason: z
    .string()
    .optional()
    .transform((r) => r?.trim().slice(0, REASON_MAX) || null),
});

const REPORTED = "Reported, thanks. Shef's team will take a look.";
const ALREADY = "You've already reported this remix. Thanks, Shef's team will take a look.";
const CANT_REPORT = "Sorry, you can't report this remix right now. Please try again later.";

/**
 * Fields: remix_id, reason (optional), return_to (optional same-site path). Inserts with the
 * user's own session: RLS allows reports only on public remixes that are not their own, never by
 * banned users. user_id and created_at are set by the database.
 */
export async function reportRemix(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const returnTo = returnPath(formData);
  const auth = await cookbookUser(returnTo);
  if (!auth) return { error: REMIX_NOT_CONFIGURED };
  const parsed = Report.safeParse(fields(formData, ["remix_id", "reason"]));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { error } = await auth.supabase.from("remix_reports").insert(parsed.data);
  if (error?.code === "23505") return { ok: true, message: ALREADY };
  if (error) return { error: CANT_REPORT };

  // The third report hides the remix, so its pages are refreshed.
  revalidateRemixes(returnTo);
  return { ok: true, message: REPORTED };
}
