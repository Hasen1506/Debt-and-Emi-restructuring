import type { Metadata } from 'next';
import { LBracket, LShell, L_T } from '@/components/ledger/primitives';
import { ACCOUNT_PATH, DATA_FIDUCIARY, GRIEVANCE_CONTACT, NOTICE_LAST_UPDATED, PRIVACY_PATH } from '@/lib/privacy-facts';

export const metadata: Metadata = { title: 'Terms of use · RightDue' };

/** Terms of use (grill #51). Plain words; public without signing in. */
const H2: React.CSSProperties = { margin: '22px 0 6px', fontSize: 14, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' };
const P: React.CSSProperties = { margin: '6px 0', fontSize: 'var(--fs-body)', lineHeight: 1.6 };
const LI: React.CSSProperties = { margin: '4px 0', fontSize: 'var(--fs-body)', lineHeight: 1.55 };

export default function TermsPage() {
  const mail = `mailto:${GRIEVANCE_CONTACT.email}`;
  return (
    <LShell>
      <article style={{ maxWidth: 760 }}>
        <h1 style={{ margin: 0, fontSize: 20, letterSpacing: '0.08em' }}>TERMS OF USE</h1>
        <p style={{ ...P, color: L_T.muted }}>Last updated {NOTICE_LAST_UPDATED}. By using {DATA_FIDUCIARY.name} you agree to these terms.</p>

        <h2 style={H2}>WHAT RIGHTDUE IS</h2>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li style={LI}>
            A set of calculators and planning tools for your own debts. Plans and figures are produced automatically by
            RightDue&apos;s engine from the numbers you enter. They are estimates, not financial, investment, tax or legal
            advice, and no person reviews them.
          </li>
          <li style={LI}>RightDue is not a lender, does not arrange or offer loans, and does not collect or move your money.</li>
          <li style={LI}>
            RightDue takes no money from lenders, NBFCs or debt-relief firms: no referral fees, commissions or paid
            placement. RightDue is run by {DATA_FIDUCIARY.operatedBy}.
          </li>
          <li style={LI}>
            Rates, rules and prices shown come from public sources, each with the date it was read. They can change or be
            wrong. Check anything important with your lender or a qualified adviser before you act on it.
          </li>
          <li style={LI}>
            Letters and complaint drafts are drafts. Read and correct them before you send them yourself. RightDue never
            sends anything to a lender, regulator or anyone else on your behalf.
          </li>
        </ul>

        <h2 style={H2}>YOUR PART</h2>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li style={LI}>You are 18 or older and use RightDue for your own finances (or with the permission of the person whose finances they are).</li>
          <li style={LI}>The results are only as good as the numbers you enter. Keep them up to date.</li>
          <li style={LI}>Keep access to your email safe: anyone who can read it can sign in as you.</li>
          <li style={LI}>
            Don&apos;t misuse the service: no automated sign-up or code requests, no attempts to reach other people&apos;s
            data, no overloading or scraping, and no false lender reports. We may block access that does.
          </li>
        </ul>

        <h2 style={H2}>THE SERVICE</h2>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li style={LI}>RightDue is free today. It runs on free hosting, so it can be slow to wake up or briefly unavailable, and we can&apos;t promise it will always be there.</li>
          <li style={LI}>
            You can stop at any time and delete your account and data on the <a href={ACCOUNT_PATH}>Your data</a> page.
            How we handle your data is in the <a href={PRIVACY_PATH}>privacy notice</a>.
          </li>
          <li style={LI}>
            RightDue is provided as it is. To the extent the law allows, we are not responsible for losses from decisions
            you make using its estimates. Nothing in these terms takes away rights you have under Indian consumer or data
            protection law.
          </li>
          <li style={LI}>If we change these terms, the date above changes; for a change that matters, we will tell you before it applies.</li>
          <li style={LI}>
            RightDue is free, so to the extent the law allows, our total liability to you for anything arising from the
            service is limited to ₹1,000 (or US$15 for users in the USA). This does not limit liability that the law
            does not allow us to limit.
          </li>
          <li style={LI}>We reply to complaints within 30 days. Data-protection grievances follow the timeline in the privacy notice.</li>
          <li style={LI}>These terms are governed by the laws of India, and courts at Chennai, Tamil Nadu have jurisdiction.</li>
        </ul>

        <h2 style={H2}>CONTACT</h2>
        <p style={P}>
          {GRIEVANCE_CONTACT.name}: <a href={mail}>{GRIEVANCE_CONTACT.email}</a>. These terms have not been checked by a lawyer.
        </p>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 18 }}>
          <LBracket href={PRIVACY_PATH}>PRIVACY NOTICE</LBracket>
          <LBracket href="/">HOME</LBracket>
        </div>
      </article>
    </LShell>
  );
}
