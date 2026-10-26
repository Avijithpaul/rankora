"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";
import type { ActionState } from "@/lib/validation/schemas";
import { requestPasswordReset, signIn, signUp, updatePassword } from "./actions";

const initial: ActionState = { ok: false };

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState(signIn, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {notice && <FormMessage tone="info">{notice}</FormMessage>}
      <FormMessage>{state.message}</FormMessage>
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Email" htmlFor="email" error={fe.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
          aria-invalid={Boolean(fe.email)}
        />
      </Field>
      <Field
        label={
          <span className="flex items-center justify-between">
            Password
            <Link href="/forgot-password" className="text-xs font-medium text-brand hover:underline">
              Forgot password?
            </Link>
          </span>
        }
        htmlFor="password"
        error={fe.password}
      >
        <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={Boolean(fe.password)} />
      </Field>
      <Button type="submit" className="w-full" loading={pending}>
        Sign in
      </Button>
      <p className="text-center text-sm text-muted">
        New to Rankora?{" "}
        <Link href="/register" className="font-medium text-brand hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(signUp, initial);
  const fe = state.fieldErrors ?? {};
  if (state.ok) {
    return (
      <div className="space-y-4">
        <FormMessage tone="success">{state.message}</FormMessage>
        <Link href="/login" className="text-sm font-medium text-brand hover:underline">
          Go to sign in →
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage>{state.message}</FormMessage>
      <Field label="Full name" htmlFor="fullName" error={fe.fullName}>
        <Input id="fullName" name="fullName" autoComplete="name" required defaultValue={state.values?.fullName} aria-invalid={Boolean(fe.fullName)} />
      </Field>
      <Field label="Work email" htmlFor="email" error={fe.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} aria-invalid={Boolean(fe.email)} />
      </Field>
      <Field label="Password" htmlFor="password" error={fe.password} hint="At least 10 characters, including a letter and a number.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={Boolean(fe.password)} />
      </Field>
      <Button type="submit" className="w-full" loading={pending}>
        Create account
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initial);
  if (state.ok) return <FormMessage tone="success">{state.message}</FormMessage>;
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage>{state.message}</FormMessage>
      <Field label="Email" htmlFor="email" error={fe.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} aria-invalid={Boolean(fe.email)} />
      </Field>
      <Button type="submit" className="w-full" loading={pending}>
        Send reset link
      </Button>
      <p className="text-center text-sm text-muted">
        <Link href="/login" className="font-medium text-brand hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function NewPasswordForm({ submitLabel = "Update password", afterSuccessHref }: { submitLabel?: string; afterSuccessHref?: string }) {
  const [state, action, pending] = useActionState(updatePassword, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage tone={state.ok ? "success" : "error"}>{state.message}</FormMessage>
      {state.ok && afterSuccessHref ? (
        <Link href={afterSuccessHref} className="text-sm font-medium text-brand hover:underline">
          Continue to Rankora →
        </Link>
      ) : (
        <>
          <Field label="New password" htmlFor="password" error={fe.password} hint="At least 10 characters, including a letter and a number.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={Boolean(fe.password)} />
          </Field>
          <Field label="Confirm new password" htmlFor="confirmPassword" error={fe.confirmPassword}>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required aria-invalid={Boolean(fe.confirmPassword)} />
          </Field>
          <Button type="submit" loading={pending}>
            {submitLabel}
          </Button>
        </>
      )}
    </form>
  );
}
