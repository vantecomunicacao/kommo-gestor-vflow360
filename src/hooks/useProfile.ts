import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/** Nome e e-mail do usuário logado (full_name de profiles, com fallback no e-mail). */
export function useProfile() {
  const { user } = useAuth();
  const [fullName, setFullName] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setFullName(null);
      return;
    }
    let active = true;
    supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setFullName(data?.full_name ?? null);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const email = user?.email ?? null;
  const displayName = fullName || email || "Usuário";
  const initial = (fullName || email || "?").charAt(0).toUpperCase();

  return { fullName, email, displayName, initial };
}
