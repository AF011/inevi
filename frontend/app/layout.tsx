import type { Metadata, Viewport } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "Inevi — Spatial AI Navigation",
  description: "AI-powered indoor spatial guide that navigates users through campuses and buildings in real time. Where Google Maps ends, Inevi begins.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Inevi",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "msapplication-TileColor": "#0D0D0D",
    "msapplication-tap-highlight": "no",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#2EC4B6",
  viewportFit: "cover", // handles iPhone notch
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* PWA icons */}
        <link rel="icon" href="/icon-192.png" sizes="192x192" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icon-512.png" />
        {/* SW registration */}
        <script dangerouslySetInnerHTML={{
          __html: `
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', function() {
                navigator.serviceWorker.register('/sw.js').catch(function() {});
              });
            }
          `
        }} />
      </head>
      <body suppressHydrationWarning>
        <Navbar />
        <main
          style={{
            marginTop: "56px",
            minHeight: "calc(100vh - 56px)",
            // Safe area for iPhone notch/home bar
            paddingBottom: "env(safe-area-inset-bottom)",
            background: "var(--bg)",
          }}
        >
          {children}
        </main>
      </body>
    </html>
  );
}