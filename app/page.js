export default function Home() {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "40rem",
        margin: "4rem auto",
        padding: "0 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <h1>Constantini Messenger Bot</h1>
      <p>
        Webhook endpoint:{" "}
        <code>/api/webhook</code>
      </p>
      <p>
        Assign the Meta Inbox label <strong>სამზარეულო bot 30 ფოტო</strong> to a
        chat (or send that saved reply from the Page) to deliver up to 30
        kitchen photos in one album.
      </p>
    </main>
  );
}
