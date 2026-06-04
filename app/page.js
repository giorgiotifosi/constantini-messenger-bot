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
        Tap <strong>სამზარეულო</strong> for kitchen photos or{" "}
        <strong>რბილი ავეჯი</strong> for divan photos — up to 30 images per
        button, sent as one album.
      </p>
      <p>
        <a href="/privacy">Privacy Policy</a>
      </p>
    </main>
  );
}
