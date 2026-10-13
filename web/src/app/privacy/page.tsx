import type { Metadata } from 'next';
import { LBracket, LShell, L_T } from '@/components/ledger/primitives';
import {
  ACCOUNT_PATH, BOARD, DATA_FIDUCIARY, GRIEVANCE_CONTACT, GRIEVANCE_REPLY_DAYS_MAX,
  NOTICE_LAST_UPDATED, RETENTION, SOURCES, STORAGE, TERMS_PATH,
} from '@/lib/privacy-facts';

export const metadata: Metadata = { title: 'Privacy notice · RightDue' };

/**
 * Privacy notice (grill #51). Written to what the DPDP Act 2023 s.5 and
 * DPDP Rules 2025 r.3 ask a notice to contain: an itemised list of the
 * personal data, the purpose of each, and how to withdraw consent, use
 * your rights and complain to the Board. Facts live in lib/privacy-facts.
 * Public: middleware lets it through without signing in.
 */
const H2: React.CSSProperties = { margin: '22px 0 6px', fontSize: 14, letterSpacing: '0.08em' };
const P: React.CSSProperties = { margin: '6px 0', fontSize: 13, lineHeight: 1.6 };
const LI: React.CSSProperties = { margin: '4px 0', fontSize: 13, lineHeight: 1.55 };
const NOTE: React.CSSProperties = { ...P, color: L_T.muted };

function Row({ what, why }: { what: React.ReactNode; why: React.ReactNode }) {
  return (
    <li style={LI}>
      <strong>{what}</strong> — {why}
    </li>
  );
}

export default function PrivacyPage() {
  const mail = `mailto:${GRIEVANCE_CONTACT.email}`;
  return (
    <LShell>
      <article style={{ maxWidth: 760 }}>
        <h1 style={{ margin: 0, fontSize: 20, letterSpacing: '0.08em' }}>PRIVACY NOTICE</h1>
        <p style={NOTE}>Last updated {NOTICE_LAST_UPDATED}. Plain words first; the legal terms are explained where they appear.</p>

        <h2 style={H2}>WHO WE ARE</h2>
        <p style={P}>
          {DATA_FIDUCIARY.name} ({DATA_FIDUCIARY.website}) is run by {DATA_FIDUCIARY.operatedBy}. Under India&apos;s
          Digital Personal Data Protection Act, 2023 (the &ldquo;DPDP Act&rdquo;) we are the <em>Data Fiduciary</em>: the
          one who decides why and how your personal data is used. You are the <em>Data Principal</em>: the person the data
          is about.
        </p>
        <p style={P}>
          Questions about your data, or a complaint: <strong>{GRIEVANCE_CONTACT.name}</strong> ({GRIEVANCE_CONTACT.role}),{' '}
          <a href={mail}>{GRIEVANCE_CONTACT.email}</a>.
        </p>

        <h2 style={H2}>WHAT WE KEEP, AND WHY</h2>
        <p style={P}>You can use the calculators without an account. If you sign in, we keep:</p>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <Row what="Your email address" why="to send your sign-in code and to know which saved plan is yours. We email you only sign-in codes and anything you switch on yourself, never marketing." />
          <Row
            what="The plan you save"
            why="your loans (lender, type, balance, interest rate, EMI or minimum, tenure, dates, any nickname or lender UPI ID you add), income, expenses, savings and emergency fund, assets and investments, goals, tax details (regime, deductions), country and city, and your activity log (payments, bonuses, decisions). We keep it so your plan is the same on every device you sign in on, and use it only to calculate your plan and tools."
          />
          <Row
            what="Sign-in records"
            why="when a code was sent and used, how many wrong codes were entered, and when each sign-in session started, ended or expires. We use them to keep your account safe and to stop misuse. Codes and session keys are stored only in a scrambled (hashed) form that can't be used to sign in."
          />
          <Row
            what="Your internet (IP) address, briefly"
            why="to limit how often one connection can request codes or send reports. We store only a keyed hash (a scrambled stand-in) of the address, never the address itself."
          />
        </ul>
        <p style={P}>Things we use but do not keep:</p>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <Row what="Numbers sent to calculate a page" why="the server works out your plan from the figures sent with the request and does not store them unless you save your plan." />
          <Row what="A Key Facts Statement (KFS) PDF you upload" why="read once to fill in the loan form for you to check; it is not saved." />
          <Row
            what="Lender outcome reports you choose to share"
            why={`anonymous: they are not linked to your account. A keyed hash of your connection is kept for ${RETENTION.outcomeClientHashDays} days to enforce a daily limit, then wiped.`}
          />
        </ul>
        <p style={P}>
          Before you sign in, your plan stays in this browser (cookies and local storage on your device). Parts of it are
          sent to our server so pages can be calculated, but nothing is stored on the server until you sign in and save.
        </p>
        <p style={P}>
          We do not sell your data, show ads, share your data with lenders, credit bureaus or brokers, or use it to train AI
          models. RightDue is not a lender.
        </p>

        <h2 style={H2}>WHO ELSE HANDLES IT</h2>
        <p style={P}>
          These services run parts of RightDue for us (under the DPDP Act they are our <em>Data Processors</em>: they act on
          our instructions, and we stay responsible):
        </p>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li style={LI}>Database: {STORAGE.database}.</li>
          <li style={LI}>App server: {STORAGE.appServer}.</li>
          <li style={LI}>Network: {STORAGE.network}.</li>
          <li style={LI}>Email: {STORAGE.email}.</li>
          <li style={LI}>
            Fonts: your browser loads the page font from Google Fonts, so Google sees your IP address when it does.
          </li>
          <li style={LI}>
            Share prices for the portfolio tool: our server asks Yahoo Finance for the ticker symbols only, never who asked.
          </li>
          <li style={LI}>
            Only when we switch them on: Sentry (error reports from our servers, with digits masked and none of your
            figures, email or address) and Cloudflare Turnstile (a check on the sign-in page that you are a person).
          </li>
        </ul>
        <p style={P}>
          So your data is stored outside India (in Singapore and the USA). The DPDP Act allows this except to countries the
          Government restricts (section 16; Rules 2025 rule 15); none is restricted today.
        </p>

        <h2 style={H2}>HOW LONG WE KEEP IT</h2>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li style={LI}>Your saved plan and email: until you delete your account.</li>
          <li style={LI}>A sign-in code: usable for {RETENTION.signInCodeMinutes} minutes, then its hash is wiped.</li>
          <li style={LI}>A sign-in session: {RETENTION.sessionDays} days, or until you sign out.</li>
          <li style={LI}>
            Sign-in records: {RETENTION.signInRecordsDays} days after the code or session ended (or until you delete your
            account, whichever is sooner), then deleted. The DPDP
            Rules 2025 ask for one year of such records so misuse can be investigated (rules 6(1)(e) and 8(3)).
          </li>
          <li style={LI}>Rate-limit counters: deleted {RETENTION.rateCounterHours} hours after their hour ends.</li>
        </ul>

        <h2 style={H2}>YOUR RIGHTS, AND HOW TO USE THEM</h2>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <Row what="See your data (DPDP Act s.11)" why={<>download everything the server holds on the <a href={ACCOUNT_PATH}>Your data</a> page.</>} />
          <Row what="Correct or update it (s.12)" why="edit it in Profile at any time." />
          <Row what="Erase it, or withdraw consent (s.12, s.6(4))" why={<>delete your account on the <a href={ACCOUNT_PATH}>Your data</a> page: type your email and confirm. It removes your saved plan, sessions and sign-in records at once. You can also clear what this browser keeps there.</>} />
          <Row what="Nominate someone (s.14)" why={<>to use these rights if you die or can&apos;t act yourself: email <a href={mail}>{GRIEVANCE_CONTACT.email}</a> with their name and email.</>} />
          <Row
            what="Complain (s.13)"
            why={<>email <a href={mail}>{GRIEVANCE_CONTACT.email}</a> from the address you sign in with. We will reply within {GRIEVANCE_REPLY_DAYS_MAX} days at the latest, the limit set by the DPDP Rules 2025 (rule 14(3)).</>}
          />
          <Row
            what="Go to the Board"
            why={`if you are not satisfied with our reply, you can complain to the ${BOARD.name}, ${BOARD.note}. The Act asks you to use our grievance process first (section 13(3)).`}
          />
        </ul>

        <h2 style={H2}>KEEPING IT SAFE</h2>
        <p style={P}>
          Connections are encrypted (HTTPS). Your sign-in session lives in a cookie page scripts can&apos;t read (HttpOnly).
          Codes and session keys are stored only as hashes. Pages tell the browser to block scripts from other sites and to
          refuse being shown inside other sites. If a breach ever affects your data, we will tell you by email without
          delay, with what happened, what it means for you and what you can do, and report it to the Board, as rule 7 of
          the DPDP Rules 2025 requires.
        </p>

        <h2 style={H2}>CHILDREN</h2>
        <p style={P}>RightDue is for adults (18 or older). Please don&apos;t create an account for anyone younger.</p>

        <h2 style={H2}>WHERE THE LAW STANDS</h2>
        <p style={NOTE}>
          The DPDP Rules 2025 were published on 14 November 2025. Most duties in the Act and Rules apply from 14 May 2027
          (eighteen months later); we follow them now. This notice has not been checked by a lawyer. Sources: the{' '}
          <a href={SOURCES.act}>DPDP Act 2023</a>, the <a href={SOURCES.rules}>DPDP Rules 2025</a> and the{' '}
          <a href={SOURCES.commencement}>commencement notification</a>, all on meity.gov.in. If we change this notice, the
          date above changes, and we will email you before a change that uses your data in a new way.
        </p>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 18 }}>
          <LBracket href={TERMS_PATH}>TERMS OF USE</LBracket>
          <LBracket href={ACCOUNT_PATH}>YOUR DATA</LBracket>
          <LBracket href="/">HOME</LBracket>
        </div>
      </article>
    </LShell>
  );
}
