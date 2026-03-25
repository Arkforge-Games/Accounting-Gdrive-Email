import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Accounting - GDrive & Email Sync",
  description: "Sync and manage accounting files from Google Drive and Email",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
