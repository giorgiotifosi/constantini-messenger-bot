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
        Send the Georgian word <strong>სამზარეულო</strong> in Messenger to
        receive three kitchen images.
      </p>
    </main>
  );
}
