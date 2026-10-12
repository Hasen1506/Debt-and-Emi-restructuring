# Monthly prompts and an AI assistant (grill #9) · translation cost (#48)

Founder: "Monthly prompts? Want me to have an LLM API linked, or user can connect Claude or GPT. Already thinking of making this available as a connector." And #48: "LLM assistance costs or free?"

Prices read on 12 October 2026 from OpenAI's API pricing page (https://developers.openai.com/api/docs/pricing). Claude's API prices weren't checked for this note; check anthropic.com/pricing before choosing a model. A **token** is the unit these services bill by, roughly 4 characters of English text; Hindi or Tamil text takes more tokens for the same meaning.

## What shipped now (no key, no cost)

- **Monthly prompts** on Home (`web/src/lib/monthly-prompts.ts`): at most three a month, each can be put off to next month. Log last month's payments if nothing is logged by the 10th; a UPI payment still to check; the debt-free date moved; in India, Jan–Mar, compare tax regimes before 31 March; and "copy your plan for an assistant".
- **Copy my plan** (`web/src/lib/plan-context.ts`): a plain-text summary (loans by type, amounts, rates, this month's payments, the debt-free month, the payoff order) with a short instruction asking the assistant to check the reasoning. The user pastes it into ChatGPT, Claude or anything else. No names, lenders or account numbers. RightDue pays nothing; the user's own plan (often free) does the thinking. This is the "user connects Claude or GPT" option without building a connector.

## Three ways to go further

| | A. RightDue pays for the model | B. User brings their own API key | C. RightDue connector (MCP server) |
|---|---|---|---|
| What it is | The server calls a model for a monthly summary or questions | The user pastes an OpenAI/Anthropic key; calls go from RightDue to the provider on their account | A RightDue "connector" the user adds inside Claude or ChatGPT; the assistant calls RightDue's tools (read the plan, try an extra payment, draft a letter) |
| Who pays for the model | RightDue | The user (pay-per-token API, separate from a ChatGPT/Claude subscription) | The user's assistant subscription; RightDue pays only for its own server |
| Cost to RightDue | A monthly summary, about 3,000 tokens in and 600 out: $0.0006 a user a month on gpt-6-luna ($0.10 in / $0.50 out per million tokens), $0.012 on gpt-6.1-sol ($2 / $10). 1,000 users for a year: about $7 or $144 | Nothing for the model; the risk of holding users' keys | Hosting: the same Render service; no model cost |
| Hard parts | Spend limits, abuse, model output reviewed for wrong advice | Storing someone's API key safely (encrypted, never logged); most users don't have an API key | Sign-in for the assistant (OAuth 2.1, below), deciding which tools are safe, listing it in each assistant's directory |
| Fit | Good for a short monthly summary in the payday email | Poor: few users have keys, high trust cost | Best long-term fit for "make it available as a connector" |

**MCP** (Model Context Protocol) is the open standard Claude and ChatGPT both use for connectors: a server describes "tools" the assistant may call. A remote MCP server that holds personal data must act as an OAuth 2.1 resource server: the assistant signs the user in through RightDue, gets a token meant only for RightDue's MCP server, and sends it on every request; RightDue must publish where its sign-in server is (OAuth Protected Resource Metadata, RFC 9728) and reject tokens meant for anything else (MCP specification, version 2026-07-28, Authorization: https://modelcontextprotocol.io/specification/latest/basic/authorization).

Sketch of the connector's tools, read-only first:
1. `get_plan`: debt-free month, payoff order, this month's payments.
2. `try_extra_payment(amount, loan)`: runs the engine's what-if; changes nothing.
3. `draft_letter(kind)`: the complaint or closure letter drafts that already exist.
Writes (log a payment, change a rate) come later, each confirmed by the user in RightDue, not in the chat.

Work: an OAuth authorization server on top of today's email sign-in (the biggest piece), the MCP endpoint over the existing engine calls, and review. Roughly two to three weeks of one engineer; an estimate, not a measured figure.

## #48: what translating the app with a model would cost

Not done this sprint, costed only. The app's own words (button labels, explanations, page text in `web/src/app` and `web/src/components`, plus the landing page) come to about 95,000 characters, about 24,000 tokens of English (counted from the code on 12 Oct 2026 with a script that reads the text in the components; the engine's explanation strings in Python and `web/src/lib` would add more).

One full pass into one language, sending the English plus instructions (about 36,000 tokens in) and getting back two to four times as many tokens (Indic scripts take more):
- gpt-6-luna: about $0.03 to $0.05 a language.
- gpt-6.1-sol: about $0.55 to $1.05 a language.

The model is not the cost. The cost is a fluent reviewer per language checking money and legal wording ("EMI", "foreclosure", "Ombudsman" each have accepted Hindi and Tamil terms), and keeping every language current as copy changes each sprint. The answer to "LLM assistance costs or free?": nearly free to run, not free to get right.

## DECISION NEEDED (in the answers file)

Which of A / B / C, and whether the payday email should include a model-written line. My recommendation: C (connector) after the payday-email D30 numbers, A only for a one-line monthly summary, never B.
