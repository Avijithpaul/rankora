"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/app/avatar";
import { displayName } from "@/lib/profile";

type Who = { name: string; email: string | null; avatar: string | null };

/**
 * Marketing header actions. Pages stay static: the server renders the signed-out buttons and,
 * in the browser, a signed-in visitor sees their avatar and a Dashboard link instead.
 * Display only — every protected route is still authorized on the server.
 */
export function HeaderAccount() {
  const [who, setWho] = useState<Who | null>(null);

  useEffect(() => {
    let alive = true;
    try {
      const supabase = createClient();
      const read = (u: { email?: string | null; user_metadata?: Record<string, unknown> } | null | undefined) => {
        if (!alive) return;
        if (!u) return setWho(null);
        const meta = u.user_metadata ?? {};
        const full = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null;
        const avatar = typeof meta.avatar_url === "string" ? meta.avatar_url : typeof meta.picture === "string" ? meta.picture : null;
        setWho({ name: displayName(full, u.email), email: u.email ?? null, avatar });
      };
      supabase.auth.getSession().then(({ data }) => read(data.session?.user));
      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => read(session?.user));
      return () => {
        alive = false;
        sub.subscription.unsubscribe();
      };
    } catch {
      /* Supabase not configured: keep the signed-out buttons */
    }
  }, []);

  if (who) {
    return (
      <>
        <ButtonLink href="/app" size="sm" className="h-10 px-4">
          <LayoutDashboard aria-hidden /> Dashboard
        </ButtonLink>
        <Link href="/app" className="rounded-full transition-transform hover:scale-105" title={who.email ?? who.name} aria-label={`Signed in as ${who.name}. Open your workspace`}>
          <Avatar name={who.name} src={who.avatar} size={36} />
        </Link>
      </>
    );
  }

  return (
    <>
      <Link href="/login" className="hidden px-2 text-[15px] font-medium text-ink hover:text-brand sm:inline">
        Sign in
      </Link>
      <ButtonLink href="/register" size="sm" className="h-10 px-4">
        Get started free
      </ButtonLink>
    </>
  );
}
