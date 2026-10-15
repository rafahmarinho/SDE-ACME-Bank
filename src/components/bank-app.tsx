"use client";
import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Bell,
  CalendarClock,
  ChevronDown,
  CreditCard,
  FileText,
  FlaskConical,
  Headphones,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  UsersRound,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Notice, TrustNote } from "@/components/banking";
import { useBank, demoEnabled } from "@/services/use-bank";
import { Overview } from "@/screens/overview";
import { Activity } from "@/screens/activity";
import { Beneficiaries, Transfer } from "@/screens/payments";
import { Cards } from "@/screens/cards";
import { Auth, Onboarding } from "@/screens/auth";
import { MFA } from "@/screens/mfa";
import {
  ProfileSettings,
  Staff,
  Statements,
  Support,
} from "@/screens/workspace";
import { seedBank } from "@/services/bank";

const customerNav = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "accounts", label: "Accounts", icon: Wallet },
  { id: "activity", label: "Activity", icon: ArrowLeftRight },
  { id: "transfers", label: "Transfers", icon: ArrowLeftRight },
  { id: "beneficiaries", label: "Beneficiaries", icon: UsersRound },
  { id: "scheduled", label: "Scheduled payments", icon: CalendarClock },
  { id: "cards", label: "Cards", icon: CreditCard },
  { id: "statements", label: "Statements", icon: FileText },
];
const staffNav = [
  { id: "staff", label: "Dashboard", icon: LayoutDashboard },
  { id: "support", label: "Support queue", icon: Headphones },
];
const commonNav = [
  { id: "support", label: "Support", icon: Headphones },
  { id: "settings", label: "Settings", icon: Settings },
];
export function BankApp() {
  const bank = useBank();
  const [page, setPage] = useState("overview");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [recovering, setRecovering] = useState(false);
  const customer = bank.actor?.role === "customer";
  const nav = customer ? customerNav : staffNav;
  const allowed = [
    ...nav,
    ...commonNav,
    { id: "profile", label: "Profile", icon: UserRound },
  ];
  const activePage = allowed.some((item) => item.id === page)
    ? page
    : customer
      ? "overview"
      : "staff";
  const profile = bank.state?.customers.find(
    (item) => item.id === bank.actor?.id,
  );
  useEffect(() => {
    const sync = () => {
      setPage(
        new URLSearchParams(window.location.search).get("view") || "overview",
      );
      setRecovering(
        new URLSearchParams(window.location.search).has("recovery") ||
          window.location.hash.includes("type=recovery"),
      );
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  function navigate(next: string) {
    setPage(next);
    setMobileMenu(false);
    setSearch("");
    window.history.pushState(null, "", `/?view=${next}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (bank.loading)
    return (
      <div className="loading-page">
        <div className="brand">
          acme<span>.</span>
        </div>
        <div className="loading-bar" />
        <p className="muted">Opening your banking space…</p>
      </div>
    );
  if (bank.mfaRequired && !recovering) return <MFA bank={bank} />;
  if (!bank.actor || recovering)
    return (
      <Auth
        bank={{
          ...bank,
          refresh: async () => {
            await bank.refresh();
            if (!window.location.search.includes("recovery"))
              setRecovering(false);
          },
        }}
      />
    );
  if (!bank.state || !profile)
    return (
      <div className="loading-page">
        <h1>We could not load your account</h1>
        <Notice bank={bank} />
        <Button onClick={bank.refresh}>Retry</Button>
        <Button variant="outline" onClick={bank.signOut}>
          Sign out
        </Button>
      </div>
    );
  function renderScreen() {
    if (customer && !profile!.onboarded) return <Onboarding bank={bank} />;
    switch (activePage) {
      case "overview":
        return <Overview bank={bank} navigate={navigate} />;
      case "accounts":
        return <Activity bank={bank} accountsPage />;
      case "activity":
        return <Activity bank={bank} />;
      case "transfers":
        return <Transfer bank={bank} />;
      case "beneficiaries":
        return <Beneficiaries bank={bank} />;
      case "scheduled":
        return <Transfer bank={bank} scheduled />;
      case "cards":
        return <Cards bank={bank} />;
      case "statements":
        return <Statements bank={bank} />;
      case "support":
        return <Support bank={bank} />;
      case "profile":
        return <ProfileSettings bank={bank} />;
      case "settings":
        return <ProfileSettings bank={bank} settings />;
      case "staff":
        return <Staff bank={bank} navigate={navigate} />;
    }
  }
  const mobileNav = customer
    ? [customerNav[0], customerNav[1], customerNav[3], customerNav[6]]
    : staffNav;
  return (
    <div className="bank-app">
      <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand">
            acme<span>.</span>
            <small>BANK</small>
          </div>
          <button
            className="mobile-close"
            aria-label="Close navigation"
            onClick={() => setMobileMenu(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-label">
          {customer ? "PERSONAL BANKING" : "BANK OPERATIONS"}
        </div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              className={activePage === item.id ? "active" : ""}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {activePage === item.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-divider" />
          <nav aria-label="Account navigation">
            {commonNav
              .filter((item) => customer || item.id !== "support")
              .map((item) => (
                <button
                  key={item.id}
                  className={activePage === item.id ? "active" : ""}
                  onClick={() => navigate(item.id)}
                >
                  <item.icon size={19} />
                  {item.label}
                </button>
              ))}
            {demoEnabled && (
              <button onClick={() => setDemoOpen(true)}>
                <FlaskConical size={19} />
                Demo workspace<span className="demo-tag">DEMO</span>
              </button>
            )}
          </nav>
          <div className="sidebar-profile">
            <button onClick={() => navigate("profile")}>
              <span className="avatar">
                {profile.name
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span>
                <strong>{profile.name}</strong>
                <small>{customer ? "Personal account" : bank.actor.role}</small>
              </span>
            </button>
            <button
              title="Sign out"
              aria-label="Sign out"
              onClick={bank.signOut}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      {mobileMenu && (
        <div className="mobile-backdrop" onClick={() => setMobileMenu(false)} />
      )}
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{customer ? "Personal banking" : "Bank operations"}</span>
            <span className="muted">/</span>
            <strong>
              {allowed.find((item) => item.id === activePage)?.label}
            </strong>
          </div>
          <div className="mobile-wordmark">
            acme<span>.</span>
          </div>
          <div className="topbar-actions">
            <div className="global-search">
              <Search size={17} />
              <input
                aria-label="Search pages"
                placeholder="Search anything…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <div className="search-results">
                  {allowed
                    .filter((item) =>
                      item.label.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((item) => (
                      <button key={item.id} onClick={() => navigate(item.id)}>
                        <item.icon size={16} />
                        {item.label}
                      </button>
                    ))}
                  {!allowed.some((item) =>
                    item.label.toLowerCase().includes(search.toLowerCase()),
                  ) && <p>No matching pages</p>}
                </div>
              )}
            </div>
            <span className="secure-label">
              <ShieldCheck size={14} />
              {demoEnabled ? "Demo session" : "Secure session"}
            </span>
            <button
              className="notification-button"
              aria-label="Notifications"
              title="Notifications"
              onClick={() => setNotificationOpen(true)}
            >
              <Bell size={20} />
              {profile.notifications && <span />}
            </button>
            <button
              className="topbar-avatar"
              aria-label="Open profile"
              onClick={() => navigate("profile")}
            >
              {profile.name
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")}
            </button>
          </div>
        </header>
        <main className="page-content" key={`${activePage}-${bank.actor.id}`}>
          <Notice bank={bank} />
          {renderScreen()}
          <footer className="page-footer">
            <TrustNote />
            <span>© 2026 ACME Bank</span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {mobileNav.map((item) => (
          <button
            key={item.id}
            className={activePage === item.id ? "active" : ""}
            onClick={() => navigate(item.id)}
          >
            <item.icon size={21} />
            <span>{item.label}</span>
          </button>
        ))}
        <button onClick={() => setMobileMenu(true)}>
          <Menu size={21} />
          <span>More</span>
        </button>
      </nav>
      <Dialog open={demoOpen} onOpenChange={setDemoOpen}>
        <DialogContent>
          <DialogTitle>Demo workspace</DialogTitle>
          <DialogDescription>
            Local simulation only. Switch perspectives to inspect customer and
            staff workflows.
          </DialogDescription>
          <div className="stack">
            {seedBank().customers.map((item) => (
              <button
                className={`demo-person ${item.id === bank.actor!.id ? "selected" : ""}`}
                key={item.id}
                onClick={() => {
                  bank.switchDemo(item.id);
                  setDemoOpen(false);
                  navigate(item.role === "customer" ? "overview" : "staff");
                }}
              >
                <span className="person-avatar">
                  {item.name
                    .split(" ")
                    .map((part) => part[0])
                    .join("")}
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small className="muted">{item.role}</small>
                </span>
                <ChevronDown size={16} className="ml-auto -rotate-90" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={notificationOpen} onOpenChange={setNotificationOpen}>
        <DialogContent>
          <DialogTitle>Account notifications</DialogTitle>
          <DialogDescription>
            {profile.notifications
              ? "Your recent account updates."
              : "Notifications are disabled in Settings."}
          </DialogDescription>
          {profile.notifications &&
            bank.state.events.slice(0, 6).map((event) => (
              <div className="event-row" key={event.id}>
                <span className="live-dot" />
                <div>
                  <strong>{event.message}</strong>
                  <small className="muted block">
                    {new Date(event.date).toLocaleDateString("en-US")}
                  </small>
                </div>
              </div>
            ))}
          {(!profile.notifications || !bank.state.events.length) && (
            <p className="muted">You are all caught up.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
