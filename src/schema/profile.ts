import { z } from "zod";
import { FactKeySchema, FACT_KEYS } from "./vocabulary";

export const FactStateSchema = z.enum(["known", "unknown", "uncertain"]);
export type FactState = z.infer<typeof FactStateSchema>;

export const FactValueSchema = z.union([z.number(), z.string(), z.boolean()]);

export const FactSchema = z.object({
  key: FactKeySchema,
  state: FactStateSchema,
  value: FactValueSchema.optional(),
  note: z.string().optional(), // short, user-facing; NOT the raw free text
});
export type Fact = z.infer<typeof FactSchema>;

export const PatientProfileSchema = z
  .object({
    // Exhaustive: every vocabulary key must be present (default state "unknown").
    facts: z.record(FactKeySchema, FactSchema),
    location: z
      .object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        radius_miles: z.number().positive(),
      })
      .optional(), // coarse only
  })
  .superRefine((profile, ctx) => {
    for (const k of FACT_KEYS) {
      const fact = profile.facts[k];
      if (fact && fact.key !== k) {
        ctx.addIssue({ code: "custom", path: ["facts", k, "key"], message: "fact.key must match its record key" });
      }
    }
  });
export type PatientProfile = z.infer<typeof PatientProfileSchema>;
