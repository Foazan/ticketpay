"use client";

import {
  changePasswordSchema,
  updateProfileSchema,
  type Account,
} from "@ticketpay/shared";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "./ui";

function Alert({
  kind,
  children,
}: {
  kind: "error" | "ok";
  children: React.ReactNode;
}) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={`rounded-md px-4 py-3 text-body-sm ${kind === "error" ? "bg-status-danger-soft" : "bg-status-success-soft"}`}
    >
      {children}
    </p>
  );
}

const firstIssue = (issues: { message: string }[]) =>
  issues[0]?.message ?? "Check the form.";

/** Full name and phone. The name is what gate staff compare with a photo ID. */
export function ProfileForm({ account }: { account: Account }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [fullName, setFullName] = useState(account.fullName);
  const [phone, setPhone] = useState(account.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "ok"; text: string } | null>(
    null,
  );
  const nameChanged = fullName.trim() !== account.fullName;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const parsed = updateProfileSchema.safeParse({ fullName, phone });
    if (!parsed.success)
      return setMsg({ kind: "error", text: firstIssue(parsed.error.issues) });
    if (
      nameChanged &&
      account.role === "BUYER" &&
      !window.confirm(
        "Change your name? At events that check ID, your photo ID must show this name.",
      )
    )
      return;
    setBusy(true);
    try {
      await apiFetch("/v1/account", { method: "PATCH", body: parsed.data });
      setMsg({ kind: "ok", text: "Your details are saved." });
      router.refresh();
    } catch (err) {
      setMsg({
        kind: "error",
        text:
          err instanceof ApiError ? err.message : "Could not reach the server.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      method="post"
      onSubmit={submit}
      className="card space-y-4 p-6"
      noValidate
    >
      <h2 className="text-h3">Your details</h2>
      {/* Disabled until React takes over, so nothing typed early is lost when the page hydrates. */}
      <fieldset disabled={!hydrated} className="space-y-4">
        <div>
          <label htmlFor="fullName" className="field-label">
            Full name
          </label>
          <input
            id="fullName"
            className="field"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            maxLength={120}
            required
          />
          <p className="mt-1 text-caption text-ink-secondary">
            {account.role === "BUYER"
              ? "Use the name on your KTP, SIM or passport. At events that check ID, gate staff compare it with this name."
              : "Shown to other TicketPay staff and in the audit log."}
          </p>
          {nameChanged && account.role === "BUYER" && (
            <p className="mt-2 rounded-md bg-status-warning-soft px-3 py-2 text-caption">
              Tickets you already hold will show the new name at the gate, with
              a note that it changed after purchase.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="email" className="field-label">
            Email
          </label>
          <input
            id="email"
            className="field bg-bg-muted"
            value={account.email}
            readOnly
            aria-describedby="email-note"
          />
          <p id="email-note" className="mt-1 text-caption text-ink-secondary">
            Your email is your login and cannot be changed in this prototype.
          </p>
        </div>
        <div>
          <label htmlFor="phone" className="field-label">
            Phone (optional)
          </label>
          <input
            id="phone"
            className="field"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            placeholder="0812 3456 7890"
          />
        </div>
      </fieldset>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Button type="submit" disabled={busy || !hydrated}>
        {busy ? "Saving…" : "Save details"}
      </Button>
    </form>
  );
}

/** Current password, then a new one. Every other signed-in device is signed out. */
export function PasswordForm() {
  const hydrated = useHydrated();
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirm: "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "ok"; text: string } | null>(
    null,
  );
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (form.newPassword !== form.confirm)
      return setMsg({ kind: "error", text: "The new passwords do not match." });
    const parsed = changePasswordSchema.safeParse({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    });
    if (!parsed.success)
      return setMsg({ kind: "error", text: firstIssue(parsed.error.issues) });
    setBusy(true);
    try {
      await apiFetch("/v1/account/password", {
        method: "POST",
        body: parsed.data,
      });
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      setMsg({
        kind: "ok",
        text: "Password changed. Other devices signed in to this account have been signed out.",
      });
    } catch (err) {
      setMsg({
        kind: "error",
        text:
          err instanceof ApiError ? err.message : "Could not reach the server.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      method="post"
      onSubmit={submit}
      className="card space-y-4 p-6"
      noValidate
    >
      <h2 className="text-h3">Change password</h2>
      {/* Lets password managers attach the new password to the right account. */}
      <input
        type="text"
        autoComplete="username"
        className="hidden"
        readOnly
        aria-hidden
        tabIndex={-1}
      />
      <fieldset disabled={!hydrated} className="space-y-4">
        <div>
          <label htmlFor="currentPassword" className="field-label">
            Current password
          </label>
          <input
            id="currentPassword"
            type="password"
            className="field"
            value={form.currentPassword}
            onChange={set("currentPassword")}
            autoComplete="current-password"
            required
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="newPassword" className="field-label">
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              className="field"
              value={form.newPassword}
              onChange={set("newPassword")}
              autoComplete="new-password"
              minLength={8}
              required
            />
            <p className="mt-1 text-caption text-ink-secondary">
              At least 8 characters.
            </p>
          </div>
          <div>
            <label htmlFor="confirm" className="field-label">
              Repeat new password
            </label>
            <input
              id="confirm"
              type="password"
              className="field"
              value={form.confirm}
              onChange={set("confirm")}
              autoComplete="new-password"
              required
            />
          </div>
        </div>
      </fieldset>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Button type="submit" variant="secondary" disabled={busy || !hydrated}>
        {busy ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
