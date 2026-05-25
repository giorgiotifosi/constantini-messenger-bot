const pageStyle = {
  fontFamily: "system-ui, sans-serif",
  maxWidth: "40rem",
  margin: "4rem auto",
  padding: "0 1.5rem",
  lineHeight: 1.6,
};

export const metadata = {
  title: "Privacy Policy — Constantini Messenger Bot",
};

export default function PrivacyPage() {
  return (
    <main style={pageStyle}>
      <h1>Privacy Policy</h1>
      <p>
        <strong>Constantini Messenger Bot</strong> is a Facebook Messenger
        service operated for Constantini. This page describes how we handle
        information when you interact with us through Messenger (for example
        after clicking a Click-to-Messenger ad or tapping the kitchen button).
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          Your Messenger <strong>Page-Scoped ID (PSID)</strong> so we can send
          you requested kitchen photos and respond in the conversation.
        </li>
        <li>
          Messages and button taps you send to our Page (for example tapping
          „სამზარეულო“).
        </li>
        <li>
          Referral data from Meta when you open a chat from an ad (such as ad
          ID), only to deliver the correct automated response.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        We use this information solely to operate the bot: send kitchen product
        photos you requested, avoid duplicate sends, and troubleshoot delivery
        issues. We do not sell your data.
      </p>

      <h2>Where data is processed</h2>
      <p>
        The bot runs on secure hosting (Vercel). Meta processes messages
        according to{" "}
        <a href="https://www.facebook.com/privacy/policy/">
          Meta&apos;s Privacy Policy
        </a>
        .
      </p>

      <h2>Retention</h2>
      <p>
        Short-term technical logs (for example webhook delivery) may be kept for
        a limited period for reliability and debugging, then discarded.
      </p>

      <h2>Your choices</h2>
      <p>
        You can stop messages anytime by blocking the Page or deleting the
        conversation in Messenger. For questions, contact Constantini through
        the contact details on our main website or Page.
      </p>

      <p>
        <a href="/">← Back to bot home</a>
      </p>
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        Last updated: May 2026
      </p>
    </main>
  );
}
