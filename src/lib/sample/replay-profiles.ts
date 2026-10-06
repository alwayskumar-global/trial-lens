// FICTIONAL profiles used to precompute replay cases (`pnpm precompute:replay`). Never real patient text.
import { SAMPLE_TEXT } from "@/lib/sample/triallens-sample";

export const REPLAY_PROFILES: ReadonlyArray<{ id: string; label: string; text: string }> = [
  { id: "her2pos-stage3", label: "Fictional profile: stage III, HER2-positive", text: SAMPLE_TEXT },
  { id: "hrpos-stage2", label: "Fictional profile: stage II, hormone-positive", text: "I'm 61 with stage II breast cancer that is hormone receptor positive and HER2 negative. I finished radiation last month and just started an aromatase inhibitor. I can travel about 50 miles." },
  { id: "tnbc-caregiver", label: "Fictional profile: triple-negative, described by a caregiver", text: "I'm helping my mother, who is 68. She has triple-negative breast cancer, and chemotherapy before surgery ended six weeks ago. She is active and walks daily. We can drive up to 75 miles." },
];
