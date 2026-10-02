# RightDue: follow-up financial-history audit

Date: 2026-10-02. Base: main `0a8077a`, after PR #13.

## New findings and corrections

| Area | Reproduction | Correction |
| --- | --- | --- |
| Entering a fresh loan statement | Enter 9,000 after a previously logged 1,000 extra. The plan starts from 8,000 by deducting that old payment again. | Payments before the reported balance date stay in history and leave the projection. New balance saves record a same-day cutoff; payments logged afterward still count. |
| Updating a card statement | An older post-payment balance of 5,000 replaces a newly entered 9,000 card balance. | Old card overrides obey the new statement cutoff too. The compressed projection records its balance anchor, so an aggregate from an older statement cannot override the new one. |
| Historical card minimums | A partial payment with a recorded minimum of 100 is treated as current after today's lower balance produces a minimum of 40. | Use the minimum recorded for that payment; calculate today's minimum only for legacy entries without one. |
| US month boundary | At 02:00 UTC on October 1 it is still September in the US. September's planned surplus is deducted immediately because the host thinks it is October. | Deferral uses the residence country's calendar, with a deterministic month-boundary regression. |
| Undoing older goal changes | Undo an older edit while a newer edit is active: the newer goal is overwritten. A stale page can also overwrite unrelated decisions added in another tab. | Read current history, reject older conflicting edits, preserve unrelated records, check the 72-hour window, and validate the goal against its saved post-change snapshot. Newest-first undo remains available. |
| Partial undo | Goal restoration succeeds but saving the reverted history fails: the goal changed and the UI reports failure. A blocked EF cookie can similarly leave a false undone record. | Commit the restored goal or EF setting and undo history in one verified local transaction. Roll back records and cookies before server sync. |
| Aged balances in save guards | Plan shows the balance after completed EMIs, but lump-payment, new-loan capacity, and recap guards still inspect the original amount. A valid lump payment is rejected, or cleared debt consumes borrowing capacity. | Those guards now use the same aging step as Plan and tool advice. |
| Partial goal/history writes | Creating a goal with initial savings succeeds before writing its decision history. A history quota error leaves a saved goal/contribution and a browser exception. Edit, cancel and delete had the same split-write risk. | Goal choices, their initial contributions, projection cookies and undo history commit together; failures preserve the original state and show an actionable error. |

Profile saves now refresh and verify the payment projection before syncing the updated profile. A blocked projection cookie restores the prior profile and cache. Existing v1-v3 activity cookies remain readable; successful writes use the anchored v4 payload inside the existing compressed envelope.

## Verification

- Twelve new unit regression groups cover the new findings and adjacent cases, including 50 deterministic shuffled multi-loan histories.
- Full frontend suite: **38 passed**.
- The six initial focused tests failed on the baseline behavior and pass with the fixes. A browser reproduction separately confirmed the partial goal/history save before its fix.
- Production build/typecheck/lint passed with the same four existing lint warnings.
- Browser replays: **37/37 Plan**, **40/40 redesigned pages/tools**, and **13/13 new financial-history scenarios**: **90/90 groups passed**. The desktop/mobile matrix includes **104 page/viewport checks**.

Browser coverage includes fresh loan/card balances through the Profile editor, same-day payments, reloads, blocked projection cookies, aged-balance lump payments, chronological undo, history quota failures, actual goal editing, stale-tab history, creation with initial savings, cancellation and historical card minimums.

## Limits

Synthetic isolated browser contexts exercise the production frontend and local API. Live OTP delivery, production database persistence and synchronization between two signed-in devices are not verified here. Browser mutation tests simulate another tab changing the stored data. No real account or payment is touched. The audit expands tested coverage and does not prove every possible financial scenario.
