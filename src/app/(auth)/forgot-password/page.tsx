import type { Metadata } from "next";
import { ForgotPasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Reset your password</h1>
      <p className="mb-8 mt-1 text-sm text-muted">Enter your account email and we&apos;ll send you a secure reset link.</p>
      <ForgotPasswordForm />
    </>
  );
}
