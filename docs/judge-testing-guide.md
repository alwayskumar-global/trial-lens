# Testing guide for judges (copy into the Devpost "testing instructions")

**What it is:** TrialLens turns a plain-language description of a *made-up* breast-cancer situation into a conservative, criterion-by-criterion screening of recruiting studies. **Demo only. Not medical advice. Please do not enter real health information, names or contact details.**

**URL:** `https://trial-lens-xi.vercel.app/`. No account or login is needed.

## 60-second path
1. Open the URL. Under "Your situation" paste a case below (or pick a fictional example).
2. Click **Review what we understood** (about 10 seconds). Check the details; correct, mark "Not sure", remove, or add any detail.
3. Click **Search for studies** (about 40-60 seconds; steps and counts stream live).
4. On Results, open any study for the criterion-by-criterion view with the study's original wording and the official ClinicalTrials.gov link. The panel "Questions worth asking the study team" lists unresolved topics across studies.

## Made-up cases you can paste
- *I'm 58, a made-up person with stage II breast cancer that is hormone receptor positive and HER2 negative. I finished radiation last month and just started an aromatase inhibitor. My heart ultrasound showed an LVEF of 60%.*
- *I'm 45 and have metastatic triple-negative breast cancer. I've had chemotherapy with a taxane and I'm looking for options after my first treatment stopped working.*
- *I'm 67 with stage I HER2-positive breast cancer. I had surgery two months ago and haven't started other treatment.*

## What to expect (so nothing looks like a bug)
- The strongest label is **Possible**; there is no "Strong match" or "eligible" by design. **Uncertain** is not a no.
- Extraction is conservative and may miss facts you wrote: that is what the review screen is for.
- Results can include loosely related studies for sparse descriptions.
- A study may show "Not analyzed this run" or "Couldn't be read"; it stays Uncertain and says so.
- Limits: a few searches per hour per visitor and a daily budget. If you hit one, the app offers **View a saved fictional example** (clearly labelled as saved, not an analysis of your text).
- If typing is disabled you will see why on the page; the fictional examples still work.

## What it is built on
NVIDIA Nemotron 3 Nano (reads your description) and Nemotron 3 Super (reads each study's criteria, compares, double-checks), served by Nebius Token Factory; studies come live from the ClinicalTrials.gov API v2. Source: `https://github.com/alwayskumar-global/trial-lens` (Apache-2.0). Limits and privacy: `README.md`.

## Honest limits
No clinician review and no accuracy figure; the deterministic vocabulary covers only about 3-6% of criteria, so most are model-judged. Text you type is sent to Nebius Token Factory; TrialLens does not store it. Nebius zero data retention is owner-attested.
