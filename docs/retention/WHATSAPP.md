# WhatsApp for payday nudges and insights (founder note on #2)

"WhatsApp messages and suggestions possible? Sending insights etc.?" Research as of 12 October 2026. Not built: see "Why not built yet".

## How it works and what it costs

- Business messages go through Meta's WhatsApp Business Platform (Cloud API, hosted by Meta). A business can start a conversation only with a pre-approved **template**; free-form messages are allowed only inside the 24-hour "customer service window" that opens when the user messages the business (Meta developer docs, Pricing).
- Since 1 July 2025 Meta charges **per delivered template message**, by category and the recipient's country code (same page).
- Categories: **marketing** (offers, "insights" that promote use), **utility** (tied to something the user asked for: a payday reminder they opted into, a deadline reminder), **authentication** (codes), **service** (replies in the window). Meta decides the category when it approves a template, and the business pays the category at time of use.
- India (+91) rates, before 18% GST: marketing ₹0.8631, utility ₹0.1150, authentication ₹0.1150 per delivered message (Meta's INR rate card as reported by Business Standard, 1 Oct 2026, and Gupshup's copy of Meta's INR card effective 1 Jan 2026). From 1 Oct 2026 Meta also charges service replies after 1,000 free per business number a month, and utility templates sent inside an open window, at the utility rate (Business Standard and The Economic Times, 1 Oct 2026). Meta's own developer page still describes utility templates inside the window as free; the rate card is the thing to check before launch.
- Volume discounts apply to utility and authentication only.

What that means for RightDue: a monthly payday reminder plus two deadline reminders is about 3 utility messages a user a month, ₹0.35 plus GST ≈ ₹0.41 a user a month, ₹4,900 a year at 1,000 users. "Insights" or "tips" would be classed as marketing at ₹0.86 each.

## What it takes

1. A Meta Business portfolio, verified business, a phone number dedicated to the WhatsApp Business account, a payment method on file.
2. Templates approved by Meta (payday list, deadline reminder), with variables for amounts and names.
3. Explicit opt-in to WhatsApp messages in the app, with the number confirmed; an opt-out that works by replying STOP.
4. A webhook for delivery status and replies ("done"), verified with the app secret.
5. India billing: Meta has moved India accounts to INR billing; accounts must be on INR by 31 Dec 2026 (Meta developer docs).

## Why not built yet

The email loop needs none of the above, costs nothing up to Resend's free quota, and answers the question that matters first: do people come back in month 2 (D30/D60, docs/retention/PAYDAY-EMAIL.md)? WhatsApp adds business verification, template approval and a per-message bill before that question is answered. Build it if email D30 is low because emails go unread, not before. The flag name `WHATSAPP_ENABLED` is reserved in `api/notify/flags.py`; the email digest text (`engine/payday.py`) is short enough to become a utility template.

## Sources

- Meta, Pricing on the WhatsApp Business Platform: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- WhatsApp Business Platform pricing page: https://business.whatsapp.com/products/platform-pricing
- Business Standard, 1 Oct 2026 (India rates and the Oct 2026 change): https://www.business-standard.com/world-news/whatsapp-business-pricing-changes-from-today-what-indian-firms-should-know-126100100165_1.html
- The Economic Times, 1 Oct 2026: https://economictimes.indiatimes.com/wealth/save/whatsapp-business-pricing-changes-from-october-1-2026-key-points-for-india/articleshow/134615391.cms
- Gupshup copy of Meta's INR rate card, effective 1 Jan 2026: https://www.gupshup.ai/resources/wp-content/uploads/2025/12/INR_Jan2026.pdf
