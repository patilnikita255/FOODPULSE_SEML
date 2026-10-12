import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Sign in as an administrator first." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "Staff invitation service is not configured." }, 500);

    const token = authorization.slice("Bearer ".length);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Your session is invalid or expired." }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: caller, error: callerError } = await admin.from("profiles")
      .select("id, organization_id, role, status")
      .eq("id", authData.user.id)
      .single();
    if (callerError || caller.role !== "ADMIN" || caller.status !== "ACTIVE") {
      return json({ error: "Only an active administrator can manage accounts." }, 403);
    }

    const { data: organization, error: organizationError } = await admin.from("organizations")
      .select("id, slug")
      .eq("id", caller.organization_id)
      .single();
    if (organizationError) return json({ error: "Administrator organization was not found." }, 400);

    const body = await request.json();
    const operation = body.operation === "update" ? "update" : "invite";
    const role = body.role;
    if (!["STUDENT", "MESS_MANAGER", "ADMIN"].includes(role)) return json({ error: "Invalid account role." }, 400);
    const fullName = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const messName = typeof body.mess_name === "string" ? body.mess_name.trim() : "";
    if (!fullName || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: "A valid name and email are required." }, 400);

    let assignedMessId: string | null = null;
    if (role === "MESS_MANAGER") {
      if (!messName) return json({ error: "Select a mess for this manager." }, 400);
      const { data: mess, error: messError } = await admin.from("messes")
        .select("id")
        .eq("organization_id", caller.organization_id)
        .eq("name", messName)
        .eq("status", "ACTIVE")
        .single();
      if (messError) return json({ error: "The selected mess is not active in your organization." }, 400);
      assignedMessId = mess.id;
    }

    let userId: string;
    if (operation === "invite") {
      const origin = request.headers.get("origin");
      const redirectTo = origin ? `${origin}/reset-password` : undefined;
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName, phone, organization_slug: organization.slug },
        ...(redirectTo ? { redirectTo } : {}),
      });
      if (error || !data.user) return json({ error: error?.message ?? "Unable to invite account." }, 400);
      userId = data.user.id;
      const { error: profileUpdateError } = await admin.from("profiles")
        .update({ full_name: fullName, phone, role })
        .eq("id", userId);
      if (profileUpdateError) return json({ error: profileUpdateError.message }, 400);
    } else {
      if (typeof body.user_id !== "string") return json({ error: "A valid user ID is required." }, 400);
      userId = body.user_id;
      const { data: target, error } = await admin.from("profiles").select("id, organization_id").eq("id", userId).single();
      if (error || target.organization_id !== caller.organization_id) return json({ error: "User is outside your organization." }, 404);
      const { error: updateError } = await admin.from("profiles").update({ full_name: fullName, phone, role }).eq("id", userId);
      if (updateError) return json({ error: updateError.message }, 400);
    }

    if (role === "MESS_MANAGER" && assignedMessId) {
      const { error: deactivateError } = await admin.from("mess_managers").update({ status: "INACTIVE" }).eq("user_id", userId);
      if (deactivateError) return json({ error: deactivateError.message }, 400);
      const { error: assignmentError } = await admin.from("mess_managers").upsert(
        { user_id: userId, mess_id: assignedMessId, status: "ACTIVE" },
        { onConflict: "user_id,mess_id" },
      );
      if (assignmentError) return json({ error: assignmentError.message }, 400);
    } else if (operation === "update") {
      const { error: assignmentError } = await admin.from("mess_managers").update({ status: "INACTIVE" }).eq("user_id", userId);
      if (assignmentError) return json({ error: assignmentError.message }, 400);
    }

    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id, full_name, email, phone, role, status, created_at")
      .eq("id", userId)
      .single();
    if (profileError) return json({ error: profileError.message }, 500);
    return json({ profile }, 200);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected account management error." }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
