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
        Opens from your Click-to-Messenger ad, Inbox label{" "}
        <strong>სამზარეულო bot 30 ფოტო</strong>, or saved reply — up to 30
        kitchen photos in one album.
      </p>
    </main>
  );
}
