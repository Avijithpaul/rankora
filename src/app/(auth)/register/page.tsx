import type { Metadata } from "next";
import { RegisterForm } from "../auth-forms";

export const metadata: Metadata = { title: "Create your account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Create your account</h1>
      <p className="mb-8 mt-1 text-sm text-muted">Start auditing your first website in minutes. No card required.</p>
      <RegisterForm />
    </>
  );
}
