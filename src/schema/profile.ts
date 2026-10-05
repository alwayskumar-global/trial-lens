import { z } from "zod";
import { FactKeySchema, FACT_KEYS, VOCABULARY } from "./vocabulary";

export const FactStateSchema = z.enum(["known", "unknown", "uncertain"]);
export type FactState = z.infer<typeof FactStateSchema>;

export const FactValueSchema = z.union([z.number(), z.string(), z.boolean()]);

export const FactSchema = z
  .object({
    key: FactKeySchema,
    state: FactStateSchema,
    value: FactValueSchema.optional(),
    note: z.string().optional(), // short, user-facing; NOT the raw free text
  })
  .superRefine((fact, ctx) => {
    // The abstention guard treats `known` as citable evidence, so `known` must carry a value
    // that conforms to the vocabulary type. unknown facts must not carry a value.
    const entry = VOCABULARY.find((e) => e.key === fact.key);
    if (fact.state === "unknown") {
      if (fact.value !== undefined) {
        ctx.addIssue({ code: "custom", path: ["value"], message: "unknown fact must not carry a value" });
      }
      return;
    }
    if (fact.state !== "known") return; // uncertain may carry a tentative value
    if (fact.value === undefined) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "known fact requires a value" });
      return;
    }
    if (!entry) return;
    const v = fact.value;
    const ok =
      entry.type === "number"
        ? typeof v === "number" && Number.isFinite(v)
        : entry.type === "bool"
          ? typeof v === "boolean"
          : typeof v === "string" && ("values" in entry ? (entry.values as readonly string[]).includes(v) : false);
    if (!ok) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "known fact value does not match the vocabulary type" });
    }
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
