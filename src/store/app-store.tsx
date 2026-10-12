import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEMO_ACCOUNTS,
  addDays,
  auditLogs,
  complaints,
  consumption,
  feedback,
  iso,
  menuFor,
  menus,
  notifications,
  payments,
  plans,
  subscriptions,
  todayISO,
  users,
} from "@/data/mock";
import type {
  AppNotification,
  AppUser,
  AuditLog,
  Complaint,
  ConsumptionRecord,
  FeedbackEntry,
  MealRecord,
  MealType,
  MenuEntry,
  Payment,
  Plan,
  Role,
  Subscription,
  SystemSettings,
} from "@/data/types";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";

const authClient = supabase as unknown as SupabaseClient;
const DEMO_SESSION_KEY = "foodpulse-demo-session";
const DEMO_PASSWORD = "demo123";
const DEMO_ACCOUNTS_BY_EMAIL: Record<string, Role> = {
  [DEMO_ACCOUNTS.student.email.toLowerCase()]: "student",
  [DEMO_ACCOUNTS.manager.email.toLowerCase()]: "manager",
  [DEMO_ACCOUNTS.admin.email.toLowerCase()]: "admin",
};

function readDemoSession() {
  try {
    const raw = window.localStorage.getItem(DEMO_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { role?: Role; currentUserId?: string };
    if (!parsed.role || !parsed.currentUserId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDemoSession(role: Role, currentUserId: string) {
  window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify({ role, currentUserId }));
}

function clearDemoSession() {
  window.localStorage.removeItem(DEMO_SESSION_KEY);
}

function buildDemoMeals(studentId: string): MealRecord[] {
  const today = todayISO();
  const out: MealRecord[] = [];
  for (let offset = -6; offset <= 7; offset++) {
    const date = iso(addDays(new Date(`${today}T00:00:00`), offset));
    (['Breakfast', 'Lunch', 'Dinner'] as MealType[]).forEach((meal, index) => {
      const selection = offset < 0 ? (index % 2 === 0 ? "Selected" : "Skipped") : "Selected";
      const attendance = offset < 0 ? (selection === "Selected" ? "Attended" : "Missed") : "Upcoming";
      out.push({
        id: `demo-${studentId}-${date}-${meal}`,
        studentId,
        date,
        meal,
        menu: menuFor(date, meal),
        selection,
        attendance,
        rating: index === 0 ? 4 : 3,
      });
    });
  }
  return out;
}

function buildDemoState(role: Role): PersistedState {
  const currentUser = DEMO_ACCOUNTS[role];
  const filteredNotifications = notifications.filter((entry) => entry.role === role);
  return {
    role,
    currentUserId: currentUser.id,
    organizationId: "demo-org",
    currentMessId: role === "student" ? "DEMO-MESS-1" : "DEMO-MESS-2",
    users,
    plans,
    subscriptions,
    meals: buildDemoMeals(currentUser.id),
    payments,
    menus,
    complaints,
    feedback,
    consumption,
    notifications: filteredNotifications,
    auditLogs,
    settings: {
      messName: role === "student" ? "North Campus Mess" : role === "manager" ? "North Campus Mess" : "FoodPulse Admin",
      contact: "+91 98450 12233",
      address: "Block C, North Campus Hostel Complex, Bengaluru 560001",
      operatingHours: "7:00 AM – 9:30 PM",
      breakfastTime: "07:30",
      lunchTime: "12:30",
      dinnerTime: "19:30",
      cutoffTime: "22:00",
      notifySubscriptionExpiry: true,
      notifyPaymentReminder: true,
      notifyMealDeadline: true,
      notifyComplaintUpdate: true,
    },
  };
}

// Supabase query results are runtime rows until the generated schema types are refreshed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = any;

interface PersistedState {
  role: Role | null;
  currentUserId: string | null;
  organizationId: string | null;
  currentMessId: string | null;
  users: AppUser[];
  plans: Plan[];
  subscriptions: Subscription[];
  meals: MealRecord[];
  payments: Payment[];
  menus: MenuEntry[];
  complaints: Complaint[];
  feedback: FeedbackEntry[];
  consumption: ConsumptionRecord[];
  notifications: AppNotification[];
  auditLogs: AuditLog[];
  settings: SystemSettings;
}

function emptyState(): PersistedState {
  return {
    role: null,
    currentUserId: null,
    organizationId: null,
    currentMessId: null,
    users: [],
    plans: [],
    subscriptions: [],
    meals: [],
    payments: [],
    menus: [],
    complaints: [],
    feedback: [],
    consumption: [],
    notifications: [],
    auditLogs: [],
    settings: {
      messName: "",
      contact: "",
      address: "",
      operatingHours: "",
      breakfastTime: "",
      lunchTime: "",
      dinnerTime: "",
      cutoffTime: "22:00",
      notifySubscriptionExpiry: true,
      notifyPaymentReminder: true,
      notifyMealDeadline: true,
      notifyComplaintUpdate: true,
    },
  };
}

const roleMap: Record<string, Role> = { STUDENT: "student", MESS_MANAGER: "manager", ADMIN: "admin" };
const fromDbRole = (role: string): Role => roleMap[role]!;
const fromDbMeal = (meal: string): MealType => ({ BREAKFAST: "Breakfast", LUNCH: "Lunch", DINNER: "Dinner" })[meal] as MealType;
const fromDbStatus = (status: string) => status.toLowerCase().replaceAll("_", " ");
const asRows = <T,>(value: unknown) => (Array.isArray(value) ? value : []) as T[];
const timeValue = (value: string | null | undefined) => value?.slice(0, 5) ?? "";
function reportWriteError(action: string, error: unknown) {
  console.error(`Unable to ${action}`, error);
  toast.error(error instanceof Error ? error.message : `Unable to ${action}. Please try again.`);
}

function mapPlan(row: DbRow): Plan {
  const includes: MealType[] = [];
  if (row.breakfast_included) includes.push("Breakfast");
  if (row.lunch_included) includes.push("Lunch");
  if (row.dinner_included) includes.push("Dinner");
  return {
    id: row.id,
    name: row.name,
    type: row.type === "WEEKLY" ? "Weekly" : "Monthly",
    price: Number(row.price),
    durationDays: row.duration_days,
    meals: row.included_meals,
    includes,
    description: row.description ?? "",
    status: row.status === "ACTIVE" ? "Active" : "Inactive",
  };
}

interface AppStore extends PersistedState {
  hydrated: boolean;
  currentUser: AppUser | null;
  signIn: (email: string, password: string) => Promise<Role>;
  signUp: (input: { name: string; email: string; phone: string; password: string; organizationSlug: string }) => Promise<boolean>;
  requestPasswordReset: (email: string) => Promise<void>;
  updateProfile: (input: { name: string; phone: string }) => Promise<void>;
  updatePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;

  // meals
  setMealSelection: (date: string, meal: MealType, selection: "Selected" | "Skipped") => void;
  rateMeal: (id: string, rating: number, feedback?: string) => void;
  isLocked: (date: string) => boolean;

  // subscription
  subscribeToPlan: (planId: string) => void;
  requestSubscriptionChange: (kind: "pause" | "cancel") => void;
  renewSubscription: () => void;
  updateSubscription: (id: string, patch: Partial<Subscription>) => void;

  // plans
  upsertPlan: (plan: Plan) => void;
  togglePlanStatus: (id: string) => void;

  // users
  upsertUser: (user: AppUser) => void;
  toggleUserStatus: (id: string) => void;

  // payments
  setPaymentStatus: (id: string, status: "Paid" | "Unpaid") => void;

  // menus
  upsertMenu: (entry: MenuEntry) => void;
  deactivateMenu: (id: string) => void;

  // complaints & feedback
  addComplaint: (c: Omit<Complaint, "id" | "status">) => void;
  updateComplaint: (id: string, patch: Partial<Complaint>) => void;
  addFeedback: (f: Omit<FeedbackEntry, "id">) => void;

  // consumption
  saveConsumption: (record: Omit<ConsumptionRecord, "id">) => void;

  // notifications
  markNotificationRead: (id: string) => Promise<void>;
  markAllRead: (role: Role) => Promise<void>;
  pushNotification: (n: Omit<AppNotification, "id" | "time" | "read">) => void;

  // settings
  updateSettings: (patch: Partial<SystemSettings>) => void;

  // audit
  logAction: (entry: Omit<AuditLog, "id" | "timestamp">) => void;

  currentSubscription: Subscription | null;
}

const Ctx = createContext<AppStore | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(() => emptyState());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;
    let notificationChannel: ReturnType<typeof authClient.channel> | undefined;
    const loadProfile = async (userId: string, email: string | undefined) => {
      const { data, error } = await authClient
        .from("profiles")
        .select("id, organization_id, full_name, email, phone, role, status, created_at")
        .eq("id", userId)
        .single();
      if (error) throw error;
      if (!mounted) return;
      if (data.status !== "ACTIVE") {
        await authClient.auth.signOut();
        throw new Error("This account is inactive. Contact your FoodPulse administrator.");
      }
      const role = fromDbRole(data.role);
      const user: AppUser = {
        id: data.id,
        name: data.full_name || "FoodPulse user",
        email: data.email || email || "",
        contact: data.phone || "",
        role,
        status: "Active",
        joinedDate: data.created_at.slice(0, 10),
      };
      const [profilesQ, messesQ, assignmentsQ, plansQ, subscriptionsQ, menusQ, mealsQ, selectionsQ, paymentsQ, complaintsQ, feedbackQ, consumptionQ, notificationsQ, auditQ, settingsQ] = await Promise.all([
        authClient.from("profiles").select("id, full_name, email, phone, role, status, created_at"),
        authClient.from("messes").select("id, name, organization_id, status").eq("organization_id", data.organization_id).eq("status", "ACTIVE"),
        authClient.from("mess_managers").select("user_id, mess_id, status").eq("status", "ACTIVE"),
        authClient.from("plans").select("*"),
        authClient.from("subscriptions").select("*"),
        authClient.from("menus").select("*"),
        authClient.from("meals").select("*"),
        authClient.from("meal_selections").select("*"),
        authClient.from("payments").select("*"),
        authClient.from("complaints").select("*"),
        authClient.from("feedback").select("*"),
        authClient.from("meal_consumption").select("*"),
        authClient.from("notifications").select("id, type, title, message, is_read, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
        authClient.from("audit_logs").select("*"),
        authClient.from("system_settings").select("*").eq("organization_id", data.organization_id).maybeSingle(),
      ]);
      for (const result of [profilesQ, messesQ, assignmentsQ, plansQ, subscriptionsQ, menusQ, mealsQ, selectionsQ, paymentsQ, complaintsQ, feedbackQ, consumptionQ, notificationsQ, auditQ, settingsQ]) {
        if (result.error) throw result.error;
      }
      const dbProfiles = asRows<DbRow>(profilesQ.data);
      const dbMesses = asRows<DbRow>(messesQ.data);
      const dbPlans = asRows<DbRow>(plansQ.data);
      const dbSubscriptions = asRows<DbRow>(subscriptionsQ.data);
      const dbMenus = asRows<DbRow>(menusQ.data);
      const dbMeals = asRows<DbRow>(mealsQ.data);
      const dbSelections = asRows<DbRow>(selectionsQ.data);
      const dbPayments = asRows<DbRow>(paymentsQ.data);
      const dbComplaints = asRows<DbRow>(complaintsQ.data);
      const dbFeedback = asRows<DbRow>(feedbackQ.data);
      const dbConsumption = asRows<DbRow>(consumptionQ.data);
      const profileById = new Map(dbProfiles.map((profile) => [profile.id, profile]));
      const planById = new Map(dbPlans.map((plan) => [plan.id, mapPlan(plan)]));
      const menuById = new Map(dbMenus.map((menu) => [menu.id, menu]));
      const mealById = new Map(dbMeals.map((meal) => [meal.id, meal]));
      const selectionByMeal = new Map(dbSelections.filter((selection) => selection.student_id === userId).map((selection) => [selection.meal_id, selection]));
      const userRows = dbProfiles.map((profile) => {
        const assignment = asRows<DbRow>(assignmentsQ.data).find((item) => item.user_id === profile.id);
        const assignedMess = assignment ? dbMesses.find((mess) => mess.id === assignment.mess_id)?.name : undefined;
        return {
          id: profile.id,
          name: profile.full_name || "FoodPulse user",
          email: profile.email || "",
          contact: profile.phone || "",
          role: fromDbRole(profile.role),
          status: profile.status === "ACTIVE" ? "Active" as const : "Inactive" as const,
          joinedDate: profile.created_at.slice(0, 10),
          ...(assignedMess ? { assignedMess } : {}),
        };
      });
      const plans = dbPlans.map(mapPlan);
      const subscriptions = dbSubscriptions.map((subscription) => {
        const student = profileById.get(subscription.student_id);
        const plan = planById.get(subscription.plan_id);
        return {
          id: subscription.id,
          studentId: subscription.student_id,
          studentName: student?.full_name || "Student",
          studentEmail: student?.email || "",
          planId: subscription.plan_id,
          planName: subscription.plan_name_snapshot || plan?.name || "Plan",
          startDate: subscription.start_date,
          endDate: subscription.end_date,
          totalMeals: subscription.total_meals,
          usedMeals: subscription.meals_used,
          status: (subscription.status[0] + subscription.status.slice(1).toLowerCase()) as Subscription["status"],
          paymentStatus: dbPayments.some((payment) => payment.subscription_id === subscription.id && payment.status === "PAID") ? "Paid" as const : "Unpaid" as const,
          requestStatus: subscription.cancellation_requested ? "Cancellation Request Pending" as const : subscription.pause_requested ? "Pause Request Pending" as const : null,
        };
      });
      const menus: MenuEntry[] = dbMenus.map((menu) => ({
        id: menu.id,
        date: menu.meal_date,
        meal: fromDbMeal(menu.meal_type),
        items: Array.isArray(menu.menu_items) ? menu.menu_items.join(", ") : "",
        special: menu.is_special,
        festival: menu.is_festival,
        active: menu.status === "ACTIVE",
      }));
      const mealRows: MealRecord[] = dbMeals.flatMap((meal) => {
        const matchingSelections = role === "student"
          ? [selectionByMeal.get(meal.id)].filter(Boolean)
          : dbSelections.filter((selection) => selection.meal_id === meal.id);
        const selections = matchingSelections.length ? matchingSelections : role === "student" ? [null] : [];
        return selections.map((selection) => {
          const menu = menuById.get(meal.menu_id);
          const selectedStatus = selection?.status === "SKIPPED" ? "Skipped" : "Selected";
          const selectedStudent = selection?.student_id || userId;
          const feedback = dbFeedback.find((entry) => entry.meal_id === meal.id && entry.student_id === selectedStudent);
          return {
            id: meal.id,
            studentId: selectedStudent,
            date: meal.meal_date,
            meal: fromDbMeal(meal.meal_type),
            menu: Array.isArray(menu?.menu_items) ? menu.menu_items.join(", ") : "",
            selection: selectedStatus as MealRecord["selection"],
            attendance: meal.meal_date >= todayISO() ? "Upcoming" as const : selectedStatus,
            rating: feedback?.rating ?? null,
            ...(feedback?.description ? { feedback: feedback.description } : {}),
          };
        });
      });
      const payments: Payment[] = dbPayments.map((payment) => {
        const subscription = dbSubscriptions.find((item) => item.id === payment.subscription_id);
        const student = profileById.get(payment.student_id);
        return {
          id: payment.id,
          invoice: payment.invoice_number,
          studentId: payment.student_id,
          studentName: student?.full_name || "Student",
          planName: subscription?.plan_name_snapshot || "Subscription",
          amount: Number(payment.amount),
          date: (payment.payment_date || payment.created_at).slice(0, 10),
          status: payment.status === "PAID" ? "Paid" : payment.status === "PENDING" ? "Pending" : "Unpaid",
          baseAmount: Number(payment.amount),
          adjustment: 0,
        };
      });
      const complaints: Complaint[] = dbComplaints.map((complaint) => {
        const student = profileById.get(complaint.student_id);
        const meal = complaint.meal_id ? mealById.get(complaint.meal_id) : undefined;
        return {
          id: complaint.id,
          studentId: complaint.student_id,
          studentName: student?.full_name || "Student",
          date: complaint.created_at.slice(0, 10),
          meal: meal ? fromDbMeal(meal.meal_type) : "Lunch",
          category: complaint.category as Complaint["category"],
          description: complaint.description,
          status: complaint.status.replace("_", " ") as Complaint["status"],
          ...(complaint.manager_response ? { response: complaint.manager_response } : {}),
        };
      });
      const feedback: FeedbackEntry[] = dbFeedback.map((entry) => {
        const student = profileById.get(entry.student_id);
        const meal = mealById.get(entry.meal_id);
        return {
          id: entry.id,
          studentId: entry.student_id,
          studentName: student?.full_name || "Student",
          date: meal?.meal_date || entry.created_at.slice(0, 10),
          meal: meal ? fromDbMeal(meal.meal_type) : "Lunch",
          rating: entry.rating,
          ...(entry.description ? { comment: entry.description } : {}),
        };
      });
      const consumption: ConsumptionRecord[] = dbConsumption.map((entry) => {
        const meal = mealById.get(entry.meal_id);
        return {
          id: entry.id,
          date: meal?.meal_date || entry.recorded_at.slice(0, 10),
          meal: meal ? fromDbMeal(meal.meal_type) : "Lunch",
          expected: entry.expected_quantity,
          prepared: entry.prepared_quantity,
          consumed: entry.consumed_quantity,
        };
      });
      const notifications = asRows<DbRow>(notificationsQ.data).map((notification) => ({
        id: notification.id,
        role,
        type: notification.type.toLowerCase() as AppNotification["type"],
        title: notification.title,
        message: notification.message,
        time: new Date(notification.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        read: notification.is_read,
      }));
      const auditLogs: AuditLog[] = asRows<DbRow>(auditQ.data).map((entry) => ({
        id: entry.id,
        timestamp: entry.created_at.slice(0, 16).replace("T", " "),
        user: profileById.get(entry.actor_user_id)?.full_name || "System",
        action: entry.action,
        module: entry.module,
        description: entry.description,
        status: "Success",
      }));
      const settings = settingsQ.data ? {
        messName: settingsQ.data.mess_name || "",
        contact: settingsQ.data.contact || "",
        address: settingsQ.data.address || "",
        operatingHours: settingsQ.data.operating_hours || "",
        breakfastTime: timeValue(settingsQ.data.breakfast_time),
        lunchTime: timeValue(settingsQ.data.lunch_time),
        dinnerTime: timeValue(settingsQ.data.dinner_time),
        cutoffTime: timeValue(settingsQ.data.meal_cutoff_time),
        notifySubscriptionExpiry: settingsQ.data.notify_subscription_expiry,
        notifyPaymentReminder: settingsQ.data.notify_payment_reminder,
        notifyMealDeadline: settingsQ.data.notify_meal_deadline,
        notifyComplaintUpdate: settingsQ.data.notify_complaint_update,
      } : emptyState().settings;
      if (!mounted) return;
      setState((current) => ({
        ...current,
        role,
        currentUserId: user.id,
        organizationId: data.organization_id,
        currentMessId: asRows<DbRow>(assignmentsQ.data).find((assignment) => assignment.user_id === userId)?.mess_id ?? dbMesses[0]?.id ?? null,
        users: userRows.some((existing) => existing.id === user.id) ? userRows : [user, ...userRows],
        plans,
        subscriptions,
        meals: mealRows,
        payments,
        menus,
        complaints,
        feedback,
        consumption,
        notifications,
        auditLogs,
        settings,
      }));
      if (notificationChannel) void authClient.removeChannel(notificationChannel);
      notificationChannel = authClient
        .channel(`foodpulse-notifications-${userId}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        }, ({ new: row }) => {
          const notification = row as {
            id: string;
            type: string;
            title: string;
            message: string;
            is_read: boolean;
            created_at: string;
          };
          setState((current) => ({
            ...current,
            notifications: [{
              id: notification.id,
              role,
              type: notification.type.toLowerCase() as AppNotification["type"],
              title: notification.title,
              message: notification.message,
              time: new Date(notification.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
              read: notification.is_read,
            }, ...current.notifications.filter((existing) => existing.id !== notification.id)],
          }));
        })
        .subscribe();
    };
    const clearSession = () => {
      clearDemoSession();
      setState(emptyState());
    };
    const demoSession = readDemoSession();
    if (demoSession) {
      setState((current) => ({ ...current, ...buildDemoState(demoSession.role ?? "student") }));
      setHydrated(true);
      return () => {
        mounted = false;
      };
    }
    const { data: authListener } = authClient.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        if (mounted) clearSession();
        if (mounted) setHydrated(true);
        return;
      }
      window.setTimeout(() => {
        void loadProfile(session.user.id, session.user.email).catch((error: unknown) => {
          console.error("Unable to load FoodPulse profile", error);
          if (mounted) clearSession();
        }).finally(() => {
          if (mounted) setHydrated(true);
        });
      }, 0);
    });
    void authClient.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      if (data.session?.user) return loadProfile(data.session.user.id, data.session.user.email);
      if (mounted) setHydrated(true);
      return;
    }).catch((error: unknown) => {
      console.error("Unable to restore FoodPulse session", error);
      if (mounted) setHydrated(true);
    });
    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
      if (notificationChannel) void authClient.removeChannel(notificationChannel);
    };
  }, []);

  const patch = useCallback((fn: (s: PersistedState) => PersistedState) => setState((s) => fn(s)), []);

  const logAction = useCallback<AppStore["logAction"]>(
    (entry) => {
      const dbEntry = {
        actor_user_id: state.currentUserId,
        action: entry.action.toUpperCase(),
        module: entry.module,
        description: entry.description,
        status: entry.status.toUpperCase(),
      };
      void authClient.from("audit_logs").insert(dbEntry).select("id, created_at").single().then(({ data, error }) => {
        if (error) throw error;
        const row = data as DbRow;
        patch((s) => ({
          ...s,
          auditLogs: [{ ...entry, id: row.id, timestamp: row.created_at.slice(0, 16).replace("T", " ") }, ...s.auditLogs],
        }));
      }, (error: unknown) => reportWriteError("record audit entry", error));
    },
    [patch, state.currentUserId],
  );

  const value = useMemo<AppStore>(() => {
    const currentUser = state.users.find((u) => u.id === state.currentUserId) ?? null;
    const currentSubscription = state.subscriptions
      .filter((s) => s.studentId === state.currentUserId)
      .sort((a, b) => Number(b.status === "Active") - Number(a.status === "Active") || b.endDate.localeCompare(a.endDate))[0] ?? null;

    return {
      ...state,
      hydrated,
      currentUser,
      currentSubscription,
      signIn: async (email, password) => {
        const normalizedEmail = email.trim().toLowerCase();
        const demoRole = DEMO_ACCOUNTS_BY_EMAIL[normalizedEmail];
        if (demoRole && password === DEMO_PASSWORD) {
          const nextState = buildDemoState(demoRole);
          setState((current) => ({ ...current, ...nextState }));
          writeDemoSession(demoRole, nextState.currentUserId);
          return demoRole;
        }
        const { data, error } = await authClient.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        if (!data.user) throw new Error("Unable to sign in. Please try again.");
        const { data: profile, error: profileError } = await authClient
          .from("profiles")
          .select("role, status")
          .eq("id", data.user.id)
          .single();
        if (profileError) throw profileError;
        if (profile.status !== "ACTIVE") {
          await authClient.auth.signOut();
          throw new Error("This account is inactive. Contact your FoodPulse administrator.");
        }
        return fromDbRole(profile.role);
      },
      signUp: async ({ name, email, phone, password, organizationSlug }) => {
        const { data, error } = await authClient.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim(), phone: phone.trim(), organization_slug: organizationSlug.trim().toLowerCase() } },
        });
        if (error) throw error;
        return !data.session;
      },
      requestPasswordReset: async (email) => {
        const redirectTo = `${window.location.origin}/reset-password`;
        const { error } = await authClient.auth.resetPasswordForEmail(email.trim(), { redirectTo });
        if (error) throw error;
      },
      updateProfile: async ({ name, phone }) => {
        const { data: sessionData } = await authClient.auth.getSession();
        const userId = sessionData.session?.user.id;
        if (!userId) throw new Error("Your session has expired. Please sign in again.");
        const { error } = await authClient.from("profiles").update({ full_name: name.trim(), phone: phone.trim() }).eq("id", userId);
        if (error) throw error;
        setState((current) => ({
          ...current,
          users: current.users.map((user) => user.id === userId ? { ...user, name: name.trim(), contact: phone.trim() } : user),
        }));
      },
      updatePassword: async (currentPassword, newPassword) => {
        const { data: sessionData } = await authClient.auth.getSession();
        const user = sessionData.session?.user;
        if (!user?.email) throw new Error("Your session has expired. Please sign in again.");
        const { error: verifyError } = await authClient.auth.signInWithPassword({ email: user.email, password: currentPassword });
        if (verifyError) throw new Error("Current password is incorrect.");
        const { error } = await authClient.auth.updateUser({ password: newPassword });
        if (error) throw error;
      },
      logout: async () => {
        clearDemoSession();
        const { error } = await authClient.auth.signOut();
        if (error) throw error;
        patch((s) => ({ ...s, role: null, currentUserId: null }));
      },
      isLocked: (date) => Date.now() >= Date.parse(`${date}T22:00:00+05:30`) - 24 * 60 * 60 * 1000,

      setMealSelection: (date, meal, selection) => {
        const mealRecord = state.meals.find((entry) => entry.date === date && entry.meal === meal && entry.studentId === state.currentUserId);
        if (!mealRecord) return;
        void authClient.rpc("set_meal_selection", {
          target_meal: mealRecord.id,
          desired_status: selection.toUpperCase(),
        }).then(({ error }) => {
          if (error) throw error;
          patch((s) => ({ ...s, meals: s.meals.map((entry) => entry.id === mealRecord.id ? { ...entry, selection } : entry) }));
        }, (error: unknown) => reportWriteError("save meal selection", error));
      },

      rateMeal: (id, rating, fb) => {
        const mealRecord = state.meals.find((entry) => entry.id === id && entry.studentId === state.currentUserId);
        const studentId = state.currentUserId;
        if (!mealRecord || !studentId) return;
        void authClient.from("feedback").upsert({
          student_id: studentId,
          meal_id: id,
          rating,
          description: fb ?? null,
        }, { onConflict: "student_id,meal_id" }).then(({ error }) => {
          if (error) throw error;
          const feedback: FeedbackEntry = {
            id: `${id}-${studentId}`,
            studentId,
            studentName: currentUser?.name ?? "Student",
            date: mealRecord.date,
            meal: mealRecord.meal,
            rating,
            ...(fb ? { comment: fb } : {}),
          };
          patch((s) => ({
            ...s,
            meals: s.meals.map((entry) => entry.id === id ? { ...entry, rating, ...(fb ? { feedback: fb } : {}) } : entry),
            feedback: [feedback, ...s.feedback.filter((entry) => !(entry.studentId === feedback.studentId && entry.date === feedback.date && entry.meal === feedback.meal))],
          }));
        }, (error: unknown) => reportWriteError("save meal feedback", error));
      },

      subscribeToPlan: (planId) => {
        if (!state.currentMessId) {
          toast.error("No active mess is configured for this organization.");
          return;
        }
        void authClient.rpc("create_subscription", { target_plan: planId, target_mess: state.currentMessId }).then(({ data, error }) => {
          if (error) throw error;
          const row = data as DbRow;
          const plan = state.plans.find((item) => item.id === planId);
          if (!plan || !row) return;
          const subscription: Subscription = {
            id: row.id,
            studentId: state.currentUserId ?? "",
            studentName: currentUser?.name ?? "Student",
            studentEmail: currentUser?.email ?? "",
            planId,
            planName: plan.name,
            startDate: row.start_date,
            endDate: row.end_date,
            totalMeals: row.total_meals,
            usedMeals: row.meals_used,
            status: "Active",
            paymentStatus: "Unpaid",
            requestStatus: null,
          };
          patch((s) => ({ ...s, subscriptions: [subscription, ...s.subscriptions.filter((item) => item.id !== subscription.id)] }));
          void authClient.from("payments").select("*").eq("subscription_id", row.id).maybeSingle().then(({ data: payment, error: paymentError }) => {
            if (paymentError || !payment) return;
            patch((s) => ({ ...s, payments: [{
              id: payment.id,
              invoice: payment.invoice_number,
              studentId: payment.student_id,
              studentName: currentUser?.name ?? "Student",
              planName: plan.name,
              amount: Number(payment.amount),
              date: payment.created_at.slice(0, 10),
              status: "Unpaid",
              baseAmount: Number(payment.amount),
              adjustment: 0,
            }, ...s.payments.filter((item) => item.id !== payment.id)] }));
          });
        }, (error: unknown) => reportWriteError("create subscription", error));
      },

      requestSubscriptionChange: (kind) => {
        const subscription = state.subscriptions.find((item) => item.studentId === state.currentUserId && item.status === "Active");
        if (!subscription) return;
        void authClient.rpc("request_subscription_change", { target_subscription: subscription.id, request_kind: kind }).then(({ error }) => {
          if (error) throw error;
          const requestStatus = kind === "cancel" ? "Cancellation Request Pending" : "Pause Request Pending";
          patch((s) => ({ ...s, subscriptions: s.subscriptions.map((item) => item.id === subscription.id ? { ...item, requestStatus } : item) }));
        }, (error: unknown) => reportWriteError("request subscription change", error));
      },

      renewSubscription: () => {
        const subscription = state.subscriptions.find((item) => item.studentId === state.currentUserId);
        if (!subscription || !state.currentMessId) return;
        void authClient.rpc("create_subscription", { target_plan: subscription.planId, target_mess: state.currentMessId }).then(({ error }) => {
          if (error) throw error;
          window.location.reload();
        }, (error: unknown) => reportWriteError("renew subscription", error));
      },

      updateSubscription: (id, p) => {
        if (p.status) {
          void authClient.rpc("update_subscription_status", { target_subscription: id, target_status: p.status.toUpperCase() }).then(({ error }) => {
            if (error) throw error;
            patch((s) => ({ ...s, subscriptions: s.subscriptions.map((sub) => sub.id === id ? { ...sub, ...p } : sub) }));
          }, (error: unknown) => reportWriteError("update subscription", error));
          return;
        }
        patch((s) => ({ ...s, subscriptions: s.subscriptions.map((sub) => sub.id === id ? { ...sub, ...p } : sub) }));
      },

      upsertPlan: (plan) => {
        if (!state.organizationId) return;
        const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(plan.id);
        const payload = {
          ...(uuid ? { id: plan.id } : {}),
          organization_id: state.organizationId,
          name: plan.name,
          type: plan.type.toUpperCase(),
          price: plan.price,
          duration_days: plan.durationDays,
          included_meals: plan.meals,
          breakfast_included: plan.includes.includes("Breakfast"),
          lunch_included: plan.includes.includes("Lunch"),
          dinner_included: plan.includes.includes("Dinner"),
          description: plan.description,
          status: plan.status === "Active" ? "ACTIVE" : "INACTIVE",
        };
        void authClient.from("plans").upsert(payload).select("*").single().then(({ data, error }) => {
          if (error) throw error;
          const saved = mapPlan(data as DbRow);
          patch((s) => ({ ...s, plans: s.plans.some((item) => item.id === saved.id) ? s.plans.map((item) => item.id === saved.id ? saved : item) : [...s.plans, saved] }));
        }, (error: unknown) => reportWriteError("save plan", error));
      },

      togglePlanStatus: (id) => {
        const plan = state.plans.find((item) => item.id === id);
        if (!plan) return;
        const status = plan.status === "Active" ? "INACTIVE" : "ACTIVE";
        void authClient.from("plans").update({ status }).eq("id", id).then(({ error }) => {
          if (error) throw error;
          patch((s) => ({ ...s, plans: s.plans.map((item) => item.id === id ? { ...item, status: status === "ACTIVE" ? "Active" : "Inactive" } : item) }));
        }, (error: unknown) => reportWriteError("update plan status", error));
      },

      upsertUser: (user) => {
        const existing = state.users.some((item) => item.id === user.id);
        void authClient.functions.invoke("manage-user", {
          body: {
            operation: existing ? "update" : "invite",
            ...(existing ? { user_id: user.id } : {}),
            name: user.name,
            email: user.email,
            phone: user.contact,
            role: user.role.toUpperCase(),
            mess_name: user.assignedMess ?? "",
          },
        }).then(({ data, error }) => {
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
          const profile = data.profile as DbRow;
          const saved: AppUser = {
            id: profile.id,
            name: profile.full_name || user.name,
            email: profile.email || user.email,
            contact: profile.phone || user.contact,
            role: fromDbRole(profile.role),
            status: profile.status === "ACTIVE" ? "Active" : "Inactive",
            joinedDate: profile.created_at.slice(0, 10),
            ...(user.role === "manager" && user.assignedMess ? { assignedMess: user.assignedMess } : {}),
          };
          patch((s) => ({ ...s, users: s.users.some((item) => item.id === saved.id) ? s.users.map((item) => item.id === saved.id ? saved : item) : [saved, ...s.users] }));
          toast.success(existing ? "Account updated" : "Invitation sent by email");
        }, (error: unknown) => reportWriteError("save user account", error));
      },

      toggleUserStatus: (id) => {
        const user = state.users.find((item) => item.id === id);
        if (!user) return;
        const status = user.status === "Active" ? "INACTIVE" : "ACTIVE";
        void authClient.from("profiles").update({ status }).eq("id", id).then(({ error }) => {
          if (error) throw error;
          patch((s) => ({ ...s, users: s.users.map((item) => item.id === id ? { ...item, status: status === "ACTIVE" ? "Active" : "Inactive" } : item) }));
        }, (error: unknown) => reportWriteError("update user status", error));
      },

      setPaymentStatus: (id, status) => {
        if (state.role === "student" && status === "Paid") {
          void authClient.rpc("report_payment", { target_payment: id }).then(({ error }) => {
            if (error) throw error;
            patch((s) => ({ ...s, payments: s.payments.map((payment) => payment.id === id ? { ...payment, status: "Pending" } : payment) }));
          }, (error: unknown) => reportWriteError("report payment", error));
          return;
        }
        const dbStatus = status === "Paid" ? "PAID" : "UNPAID";
        void authClient.from("payments").update({ status: dbStatus, payment_date: status === "Paid" ? new Date().toISOString() : null, payment_method: status === "Paid" ? "CASH" : null }).eq("id", id).then(({ error }) => {
          if (error) throw error;
          patch((s) => ({ ...s, payments: s.payments.map((payment) => payment.id === id ? { ...payment, status, date: status === "Paid" ? todayISO() : payment.date } : payment) }));
        }, (error: unknown) => reportWriteError("update payment status", error));
      },

      upsertMenu: (entry) => {
        if (!state.currentMessId) return;
        const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(entry.id);
        const mealType = { Breakfast: "BREAKFAST", Lunch: "LUNCH", Dinner: "DINNER" }[entry.meal];
        const payload = {
          ...(uuid ? { id: entry.id } : {}),
          mess_id: state.currentMessId,
          meal_date: entry.date,
          meal_type: mealType,
          menu_items: entry.items.split(",").map((item) => item.trim()).filter(Boolean),
          is_special: entry.special,
          is_festival: entry.festival,
          status: entry.active ? "ACTIVE" : "INACTIVE",
          created_by: state.currentUserId,
        };
        void authClient.from("menus").upsert(payload, { onConflict: "mess_id,meal_date,meal_type" }).select("*").single().then(({ data, error }) => {
          if (error) throw error;
          const row = data as DbRow;
          const saved: MenuEntry = { id: row.id, date: row.meal_date, meal: fromDbMeal(row.meal_type), items: row.menu_items.join(", "), special: row.is_special, festival: row.is_festival, active: row.status === "ACTIVE" };
          patch((s) => ({ ...s, menus: [saved, ...s.menus.filter((item) => item.id !== saved.id)] }));
        }, (error: unknown) => reportWriteError("save menu", error));
      },

      deactivateMenu: (id) => {
        void authClient.from("menus").update({ status: "INACTIVE" }).eq("id", id).then(({ error }) => {
          if (error) throw error;
          patch((s) => ({ ...s, menus: s.menus.map((menu) => menu.id === id ? { ...menu, active: false } : menu) }));
        }, (error: unknown) => reportWriteError("deactivate menu", error));
      },

      addComplaint: (c) => {
        const mealRow = state.meals.find((item) => item.studentId === state.currentUserId && item.date === c.date && item.meal === c.meal);
        if (!state.currentMessId || !state.currentUserId) return;
        void authClient.from("complaints").insert({ student_id: state.currentUserId, mess_id: state.currentMessId, meal_id: mealRow?.id ?? null, category: c.category, description: c.description }).select("*").single().then(({ data, error }) => {
          if (error) throw error;
          const row = data as DbRow;
          patch((s) => ({ ...s, complaints: [{ ...c, id: row.id, studentId: row.student_id, status: "OPEN" }, ...s.complaints] }));
        }, (error: unknown) => reportWriteError("submit complaint", error));
      },

      updateComplaint: (id, p) => {
        const dbPatch: DbRow = {};
        if (p.response !== undefined) dbPatch.manager_response = p.response;
        if (p.status) dbPatch.status = p.status.replaceAll(" ", "_");
        if (!Object.keys(dbPatch).length) return;
        void authClient.from("complaints").update(dbPatch).eq("id", id).then(({ error }) => {
          if (error) throw error;
          patch((s) => ({ ...s, complaints: s.complaints.map((complaint) => complaint.id === id ? { ...complaint, ...p } : complaint) }));
        }, (error: unknown) => reportWriteError("update complaint", error));
      },

      addFeedback: (f) => {
        const mealRow = state.meals.find((item) => item.studentId === state.currentUserId && item.date === f.date && item.meal === f.meal);
        if (!mealRow || !state.currentUserId) return;
        void authClient.from("feedback").upsert({ student_id: state.currentUserId, meal_id: mealRow.id, rating: f.rating, description: f.comment ?? null }, { onConflict: "student_id,meal_id" }).then(({ data, error }) => {
          if (error) throw error;
          const id = (data as DbRow | null)?.id ?? `${mealRow.id}-feedback`;
          patch((s) => ({ ...s, feedback: [{ ...f, id }, ...s.feedback.filter((entry) => !(entry.studentId === state.currentUserId && entry.date === f.date && entry.meal === f.meal))] }));
        }, (error: unknown) => reportWriteError("save feedback", error));
      },

      saveConsumption: (record) => {
        const meal = state.meals.find((item) => item.date === record.date && item.meal === record.meal);
        if (!meal) return;
        void authClient.rpc("record_meal_consumption", { target_meal: meal.id, prepared: record.prepared, consumed: record.consumed }).then(({ data, error }) => {
          if (error) throw error;
          const row = data as DbRow;
          const saved = { ...record, id: row.id, expected: row.expected_quantity };
          patch((s) => ({ ...s, consumption: [saved, ...s.consumption.filter((item) => !(item.date === record.date && item.meal === record.meal))] }));
        }, (error: unknown) => reportWriteError("save consumption", error));
      },

      markNotificationRead: async (id) => {
        const userId = state.currentUserId;
        if (!userId) return;
        const { error } = await authClient.from("notifications").update({ is_read: true }).eq("id", id).eq("user_id", userId);
        if (error) throw error;
        patch((s) => ({ ...s, notifications: s.notifications.map((n) => n.id === id ? { ...n, read: true } : n) }));
      },

      markAllRead: async (role) => {
        const userId = state.currentUserId;
        if (!userId || state.role !== role) return;
        const { error } = await authClient.from("notifications").update({ is_read: true }).eq("user_id", userId).eq("is_read", false);
        if (error) throw error;
        patch((s) => ({ ...s, notifications: s.notifications.map((n) => n.role === role ? { ...n, read: true } : n) }));
      },

      pushNotification: (n) =>
        patch((s) => ({
          ...s,
          notifications: [
            { ...n, id: `N-${Date.now()}`, time: "Just now", read: false },
            ...s.notifications,
          ],
        })),

      updateSettings: (p) => {
        if (!state.organizationId) return;
        const dbPatch: DbRow = { organization_id: state.organizationId };
        if (p.messName !== undefined) dbPatch.mess_name = p.messName;
        if (p.contact !== undefined) dbPatch.contact = p.contact;
        if (p.address !== undefined) dbPatch.address = p.address;
        if (p.operatingHours !== undefined) dbPatch.operating_hours = p.operatingHours;
        if (p.breakfastTime !== undefined) dbPatch.breakfast_time = p.breakfastTime || null;
        if (p.lunchTime !== undefined) dbPatch.lunch_time = p.lunchTime || null;
        if (p.dinnerTime !== undefined) dbPatch.dinner_time = p.dinnerTime || null;
        if (p.cutoffTime !== undefined) dbPatch.meal_cutoff_time = p.cutoffTime;
        if (p.notifySubscriptionExpiry !== undefined) dbPatch.notify_subscription_expiry = p.notifySubscriptionExpiry;
        if (p.notifyPaymentReminder !== undefined) dbPatch.notify_payment_reminder = p.notifyPaymentReminder;
        if (p.notifyMealDeadline !== undefined) dbPatch.notify_meal_deadline = p.notifyMealDeadline;
        if (p.notifyComplaintUpdate !== undefined) dbPatch.notify_complaint_update = p.notifyComplaintUpdate;
        void authClient.from("system_settings").upsert(dbPatch, { onConflict: "organization_id" }).then(({ error }) => {
          if (error) throw error;
          patch((s) => ({ ...s, settings: { ...s.settings, ...p } }));
        }, (error: unknown) => reportWriteError("save settings", error));
      },

      logAction,
    };
  }, [state, hydrated, patch, logAction]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside AppStoreProvider");
  return ctx;
}
