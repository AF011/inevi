import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "Inevi — Spatial AI Navigation",
  description: "AI-powered indoor spatial guide that navigates users through campuses and museums in real time.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">      
      <body suppressHydrationWarning>
        <Navbar />
        <main
          style={{
            marginTop: "56px",
            minHeight: "calc(100vh - 56px)",
            background: "var(--bg)",
          }}
        >
          {children}
        </main>
      </body>
    </html>
  );
}