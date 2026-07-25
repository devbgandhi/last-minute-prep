import "./globals.css";

export const metadata = {
  title: "Last Minute Prep",
  description: "Guest-first interview practice app",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}