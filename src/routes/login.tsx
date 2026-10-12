import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, GraduationCap, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Logo } from "@/components/fp/logo";
import { useApp } from "@/store/app-store";
import { roleHome } from "@/components/fp/nav-config";
import { DEMO_ACCOUNTS } from "@/data/mock";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Login | FoodPulse" },
      { name: "description", content: "Sign in to your FoodPulse student, mess manager, or administrator account." },
      { property: "og:title", content: "Login | FoodPulse" },
      { property: "og:description", content: "Sign in to your FoodPulse account." },
    ],
  }),
  component: LoginPage,
});

const demoAccounts = [
  {
    role: "student",
    label: "Login as Student",
    description: "Meals, subscription, billing, feedback",
    email: DEMO_ACCOUNTS.student.email,
    password: "demo123",
    icon: GraduationCap,
  },
  {
    role: "manager",
    label: "Login as Mess Manager",
    description: "Menu, consumption, wastage, analytics",
    email: DEMO_ACCOUNTS.manager.email,
    password: "demo123",
    icon: Users,
  },
  {
    role: "admin",
    label: "Login as Admin",
    description: "Users, plans, reports, audit logs",
    email: DEMO_ACCOUNTS.admin.email,
    password: "demo123",
    icon: ShieldCheck,
  },
] as const;

function LoginPage() {
  const { signIn } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const loginDemoAccount = async (candidate: (typeof demoAccounts)[number]) => {
    setEmail(candidate.email);
    setPassword(candidate.password);
    setErrors({});
    setSubmitting(true);
    try {
      const role = await signIn(candidate.email, candidate.password);
      toast.success("Signed in to FoodPulse demo account");
      navigate({ to: roleHome[role] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to sign in with the demo account.");
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: { email?: string; password?: string } = {};
    if (!email.trim()) next.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = "Enter a valid email address";
    if (!password) next.password = "Password is required";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSubmitting(true);
    try {
      const role = await signIn(email, password);
      toast.success("Signed in to FoodPulse");
      navigate({ to: roleHome[role] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to sign in. Check your email and password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="fp-hero-glow hidden flex-col justify-between p-10 lg:flex">
        <Logo />
        <div className="max-w-md">
          <h1 className="font-display text-4xl leading-tight font-semibold">
            Manage meals smarter. Reduce food waste.
          </h1>
          <p className="mt-4 text-muted-foreground">
            FoodPulse turns daily meal selections into demand forecasts, so the kitchen cooks what's actually
            eaten — and students only pay for meals they want.
          </p>
          <dl className="mt-8 grid grid-cols-3 gap-4">
            {[
              ["9.6%", "Avg. wastage"],
              ["246", "Students"],
              ["817", "Meals / day"],
            ].map(([v, l]) => (
              <div key={l} className="fp-surface p-4">
                <dt className="font-display text-2xl font-semibold">{v}</dt>
                <dd className="text-xs text-muted-foreground">{l}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-xs text-muted-foreground">
          Secure email sign-in for your FoodPulse account.
        </p>
      </div>

      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="lg:hidden">
            <Logo />
          </div>
          <h2 className="mt-6 font-display text-2xl font-semibold">Welcome back</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your FoodPulse workspace.</p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@campus.edu.in"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "email-error" : undefined}
              />
              {errors.email && <p id="email-error" className="text-xs text-destructive">{errors.email}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                aria-invalid={!!errors.password}
              />
              {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox id="remember" /> Remember me
              </label>
              <Link to="/forgot-password" className="text-sm font-medium text-primary hover:underline">
                Forgot password?
              </Link>
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Signing in..." : "Login"}
            </Button>
          </form>

          <div className="mt-8">
            <div className="mb-4 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              Or try a demo account
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-3">
              {demoAccounts.map((account) => {
                const Icon = account.icon;
                return (
                  <button
                    key={account.role}
                    type="button"
                    onClick={() => void loginDemoAccount(account)}
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-accent"
                  >
                    <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold text-foreground">{account.label}</span>
                      <span className="block text-xs text-muted-foreground">{account.description}</span>
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            New to FoodPulse?{" "}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
