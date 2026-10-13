# Job field → curated insights (idea write-up only; nothing built)

Founder note on #2: "Job field → curated segments like how likely their field is to cross AI replacement threshold."

## What it would be

An optional "What do you do for work?" in Profile (a short list, not free text). RightDue uses it for two things:

1. **Income-risk context for the plan.** If a field is one where generative AI is likely to change the work, the plan could suggest a larger emergency fund before extra prepayments, and show the "if your income drops" scenario first. That's an existing engine lever (emergency-fund target, income scenarios), not new maths.
2. **A short monthly note** in the payday email or Home's prompts: one line about the field, with its source.

## The data source to use

The ILO's index is the most defensible public source: *Generative AI and Jobs: A Refined Global Index of Occupational Exposure*, ILO Working Paper 140, May 2025 (Gmyrek et al., with Poland's NASK). It scores occupations (ISCO-08, about 30,000 tasks) on four exposure "gradients", from low to high. ILO's own headline: "one in four jobs at risk of being transformed by GenAI", and it stresses that **transformation of jobs is the most likely impact, not replacement**, since most occupations are bundles of tasks that still need people.
- Paper: https://www.ilo.org/publications/generative-ai-and-jobs-refined-global-index-occupational-exposure
- News release (20 May 2025): https://www.ilo.org/resource/news/one-four-jobs-risk-being-transformed-genai-new-ilo%E2%80%93nask-global-index-shows

## Honest framing (the hard part)

- "AI replacement threshold" isn't something the index measures. It measures **exposure**: how much of a job's tasks GenAI could do. Exposure isn't job loss. The copy must say "exposed to change", never "likely to be replaced", and never give a person a probability of losing their job.
- The index is global and occupation-level. It says nothing about one person's employer, skills or contract. India-specific weights (via national labour data) would need the ILO's country method or a partner.
- It's sensitive: a debt app telling someone their job is at risk can frighten more than help. Make it opt-in, explain what it changes in the plan, and let the user turn it off.
- It's personal data: collect only the field, only with consent, use it only for the plan, and delete it with the account.

## What it would take

1. Map ISCO-08 major groups to 15–20 plain field names (an afternoon, with the ILO's annex).
2. Store the gradient per field with its source and date in `api/data/` (a sourced data file, like the rate tables).
3. One engine rule: field gradient 3–4 → emergency-fund target +1 month before prepayment suggestions, with the reason shown.
4. Copy review against honest-copy rules.

## Recommendation

Wait for D30/D60 from the payday email first. If retention holds, this is a good "unique" feature for month 3, built as context for the plan, not as a prediction about the user's job.
