export const metadata = {
  title: "Constantini Messenger Bot",
  description: "Meta Facebook Messenger webhook bot",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
