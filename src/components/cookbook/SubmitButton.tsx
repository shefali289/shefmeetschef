"use client";
import type { ButtonHTMLAttributes } from "react";

export type SubmitButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "disabled"> & {
  pending: boolean;
};

/**
 * Submit button that stays focusable while its form is sending (aria-disabled, not disabled, so
 * keyboard focus is not lost) and ignores repeat clicks or Enter presses until the action returns.
 */
export default function SubmitButton({ pending, onClick, className = "", ...rest }: SubmitButtonProps) {
  return (
    <button
      {...rest}
      type="submit"
      aria-disabled={pending || undefined}
      onClick={(e) => {
        if (pending) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={`${className} aria-disabled:cursor-wait aria-disabled:opacity-70`}
    />
  );
}
