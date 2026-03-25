"use client";

import Link from "next/link";
import { IconGoogle, IconMicrosoft } from "@/components/icons";
import { cx } from "@/lib/cn";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4">
            A
          </div>
          <h1 className="text-2xl font-bold">Sign in to AccountSync</h1>
          <p className="text-gray-500 mt-2">Connect your accounts to get started</p>
        </div>

        <div className={`${cx.card} p-8 space-y-4`}>
          <a
            href="/api/auth/google"
            className={`${cx.btnSecondary} w-full justify-center py-3 text-base`}
          >
            <IconGoogle className="w-5 h-5" />
            Continue with Google
          </a>

          <a
            href="/api/auth/microsoft"
            className={`${cx.btnSecondary} w-full justify-center py-3 text-base`}
          >
            <IconMicrosoft className="w-5 h-5" />
            Continue with Microsoft
          </a>

          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-3 text-sm text-gray-400">or</span>
            </div>
          </div>

          <Link
            href="/dashboard"
            className={`${cx.btnPrimary} w-full justify-center py-3 text-base`}
          >
            Skip to Dashboard
          </Link>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          By signing in, you agree to let AccountSync access your Google Drive and email files.
        </p>
      </div>
    </div>
  );
}
