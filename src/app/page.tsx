import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-4 border-b bg-white/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
            A
          </div>
          <span className="font-bold text-lg">AccountSync</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">
            Sign In
          </Link>
          <Link href="/login" className="px-4 py-2 rounded-lg font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 inline-flex items-center gap-2">
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="max-w-5xl mx-auto px-8 py-24 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium mb-6">
          <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          Accounting File Manager
        </div>

        <h1 className="text-5xl font-extrabold tracking-tight leading-tight mb-6">
          All your accounting files
          <br />
          <span className="text-blue-600">in one place</span>
        </h1>

        <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-10">
          Automatically sync invoices, receipts, and documents from Google Drive
          and email. Search, organize, and manage everything from a single
          dashboard.
        </p>

        <div className="flex items-center justify-center gap-4 mb-16">
          <Link href="/login" className="px-6 py-3 rounded-lg font-medium text-base bg-blue-600 text-white hover:bg-blue-700 inline-flex items-center gap-2">
            Open Dashboard
          </Link>
          <Link href="/login" className="px-6 py-3 rounded-lg font-medium text-base bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 inline-flex items-center gap-2">
            Setup Guide
          </Link>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left mt-12">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
            </div>
            <h3 className="font-semibold text-lg mb-2">Google Drive Sync</h3>
            <p className="text-gray-500 text-sm">
              Automatically pull all accounting files from your Google Drive folders.
              Supports shared drives and nested folders.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="font-semibold text-lg mb-2">Email Attachments</h3>
            <p className="text-gray-500 text-sm">
              Extract invoices and receipts from email attachments automatically.
              Supports Outlook and Gmail.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h3 className="font-semibold text-lg mb-2">Search & Organize</h3>
            <p className="text-gray-500 text-sm">
              Powerful search across all files. Filter by date, type, source, and
              tags. Star important documents for quick access.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
