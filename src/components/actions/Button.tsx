import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

export interface ButtonProps extends Omit<ComponentPropsWithoutRef<"button">, "children"> {
  variant?: "primary" | "secondary" | "quiet";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  iconAfter?: ReactNode;
  /** Render as another element, e.g. "a" */
  as?: ElementType;
  children?: ReactNode;
  href?: string;
  target?: string;
  rel?: string;
}

/** Forest-green button; one primary per screen. The final CTA is "Open on ClinicalTrials.gov" until contact data exists (docs/copy-rules.md). */
export function Button({ variant = "primary", size = "md", icon, iconAfter, as, children, className = "", ...rest }: ButtonProps) {
  const Tag: ElementType = as ?? "button";
  const cls = "tl-btn tl-btn--" + variant + (size === "sm" ? "" : " tl-btn--" + size) + (className ? " " + className : "");
  const extra = Tag === "button" && !rest.type ? { type: "button" as const } : {};
  return (
    <Tag className={cls} {...extra} {...rest}>
      {icon}
      {children}
      {iconAfter}
    </Tag>
  );
}
