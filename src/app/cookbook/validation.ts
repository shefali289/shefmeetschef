import "server-only";
import { z } from "zod";

/** A database id from a form field. */
export const uuidField = z.uuid({ error: "That link looks broken. Please refresh and try again." });

/** Reads only the named string fields, so nothing else the client sends reaches the database. */
export function fields(formData: FormData, names: string[]): Record<string, string | undefined> {
  return Object.fromEntries(
    names.map((n) => {
      const v = formData.get(n);
      return [n, typeof v === "string" ? v : undefined];
    }),
  );
}

/** The first validation message, for showing next to the control. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}
