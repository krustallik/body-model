"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useI18n } from "@/i18n/i18n-provider";
import styles from "./auth.module.css";

type AuthMode = "login" | "register" | "forgot" | "password-setup" | "change-password";
type RegistrationStep = "details" | "verify-email" | "set-password";
type AuthFlowProps = { mode: AuthMode; signedInEmail?: string };

export function AuthFlow({ mode, signedInEmail }: AuthFlowProps) {
  const router = useRouter();
  const { locale } = useI18n();
  const uk = locale === "uk";
  const [email, setEmail] = useState(signedInEmail ?? "");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [otp, setOtp] = useState("");
  const [registrationStep, setRegistrationStep] = useState<RegistrationStep>("details");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(path: string, body?: unknown): Promise<Response> {
    return fetch(path, {
      method: body === undefined ? "POST" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  }

  async function openAccount(): Promise<void> {
    const response = await fetch("/api/account/bootstrap-status", { cache: "no-store" });
    if (!response.ok) throw new Error(uk ? "Не вдалося перевірити стан акаунта." : "Unable to check account status.");
    const state = await response.json() as { passwordChangeRequired: boolean; onboardingRequired: boolean };
    router.replace(state.passwordChangeRequired ? "/password-setup" : state.onboardingRequired ? "/onboarding" : "/dashboard");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "login") {
        const response = await send("/api/account/login", { email: email.trim().toLowerCase(), password });
        if (!response.ok) throw new Error(uk ? "Не вдалося увійти. Перевірте email і пароль." : "Unable to sign in. Check your email and password.");
        await openAccount();
        return;
      }

      if (mode === "forgot" && registrationStep === "details") {
        const response = await send("/api/registration/password-reset/request", { email: email.trim().toLowerCase() });
        if (!response.ok) throw new Error(uk ? "Не вдалося надіслати код. Спробуйте пізніше." : "Unable to send a code. Try again later.");
        setRegistrationStep("set-password");
        setNotice(uk ? "Якщо акаунт може виконати цю дію, BodyCast спробує надіслати код. Якщо листа немає, перевірте адресу або спробуйте пізніше." : "If the account is eligible, BodyCast will try to send a code. If it does not arrive, check the address or try again later.");
        return;
      }

      if (mode === "register" && registrationStep === "details") {
        const response = await send("/api/registration/start", { email: email.trim().toLowerCase(), name: name.trim() });
        if (!response.ok) throw new Error(uk ? "Реєстрація тимчасово недоступна. Спробуйте пізніше." : "Registration is temporarily unavailable. Try again later.");
        setRegistrationStep("verify-email");
        setNotice(uk ? "Якщо адресу можна зареєструвати, BodyCast спробує надіслати код. Якщо листа немає, перевірте адресу або спробуйте пізніше." : "If this address can be registered, BodyCast will try to send a code. If it does not arrive, check the address or try again later.");
        return;
      }

      if (mode === "register" && registrationStep === "verify-email") {
        const response = await send("/api/auth/email-otp/verify-email", { email: email.trim().toLowerCase(), otp });
        if (!response.ok) throw new Error(uk ? "Код недійсний або прострочений." : "The code is invalid or expired.");
        const request = await send("/api/registration/password-reset/request", { email: email.trim().toLowerCase() });
        if (!request.ok) throw new Error(uk ? "Email підтверджено, але пароль поки не можна встановити. Запросіть новий код підтвердження." : "Email verified, but a password cannot be set yet. Request a new verification code.");
        setOtp("");
        setRegistrationStep("set-password");
        setNotice(uk ? "Email підтверджено. Коли отримаєте другий код, введіть його для створення пароля. Якщо листа немає, надішліть код ще раз." : "Email verified. Enter the second code to create a password when it arrives. If it does not, request another code.");
        return;
      }

      if ((mode === "register" && registrationStep === "set-password") || (mode === "forgot" && registrationStep === "set-password") || mode === "password-setup" || mode === "change-password") {
        if (password.length < 12 || password.length > 128) throw new Error(uk ? "Пароль має містити від 12 до 128 символів." : "Password must contain 12–128 characters.");
        if (password !== confirmation) throw new Error(uk ? "Паролі не збігаються." : "Passwords do not match.");
        const response = mode === "password-setup" || mode === "change-password"
          ? await send("/api/account/password-change", { otp, password })
          : await send("/api/registration/password-reset", { email: email.trim().toLowerCase(), otp, password });
        if (!response.ok) throw new Error(uk ? "Код недійсний або прострочений. Запросіть новий код і спробуйте ще раз." : "The code is invalid or expired. Request a new code and try again.");
        if (mode === "register") {
          const login = await send("/api/account/login", { email: email.trim().toLowerCase(), password });
          if (!login.ok) throw new Error(uk ? "Пароль створено. Тепер увійдіть." : "Password created. Sign in now.");
          await openAccount();
          return;
        }
        setNotice(uk ? "Пароль змінено. Увійдіть із новим паролем." : "Password changed. Sign in with your new password.");
        router.replace("/login");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (uk ? "Сталася помилка." : "Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  async function requestOtp() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const path = mode === "password-setup" || mode === "change-password" ? "/api/account/password-change/request"
        : mode === "register" && registrationStep === "verify-email" ? "/api/registration/resend"
          : "/api/registration/password-reset/request";
      const response = await send(path, path === "/api/account/password-change/request" ? undefined : {
        email: email.trim().toLowerCase(),
        ...(mode === "register" ? { name: name.trim() } : {}),
      });
      if (!response.ok) throw new Error(uk ? "Не вдалося надіслати код. Спробуйте пізніше." : "Unable to send a code. Try again later.");
      setNotice(uk ? "Якщо акаунт може виконати цю дію, BodyCast спробує надіслати код. Якщо листа немає, перевірте адресу або спробуйте пізніше." : "If the account is eligible, BodyCast will try to send a code. If it does not arrive, check the address or try again later.");
      if (mode === "forgot") setRegistrationStep("set-password");
      if (mode === "password-setup" || mode === "change-password") setRegistrationStep("set-password");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (uk ? "Сталася помилка." : "Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      const response = await send("/api/auth/sign-out");
      if (!response.ok) throw new Error(uk ? "Не вдалося завершити сеанс." : "Unable to sign out.");
      router.replace("/login");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (uk ? "Сталася помилка." : "Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "login" ? (uk ? "Увійти в BodyCast" : "Sign in to BodyCast")
    : mode === "register" ? (uk ? "Створити акаунт" : "Create an account")
      : mode === "password-setup" || mode === "change-password" ? (uk ? "Змініть пароль" : "Change your password")
        : (uk ? "Відновити пароль" : "Reset your password");

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="auth-title">
        <Link href="/" className={styles.brand}>BodyCast<span>{uk ? "Ваш особистий простір" : "Your personal workspace"}</span></Link>
        <p className={styles.eyebrow}>{uk ? "Захищений особистий профіль" : "Secure personal profile"}</p>
        <h1 id="auth-title">{title}</h1>
        {mode === "register" && registrationStep === "details" && <p className={styles.description}>{uk ? "Підтвердіть email кодом. Після цього окремий код дозволить створити пароль." : "Verify your email with a code. A separate code will then let you create a password."}</p>}
        {(mode === "password-setup" || mode === "change-password") && <p className={styles.description}>{uk ? "Для зміни пароля потрібен код, надісланий на email акаунта. Після зміни увійдіть знову." : "A code sent to your account email is required. Sign in again after changing your password."}</p>}
        <form onSubmit={handleSubmit} className={styles.form}>
          {(mode !== "password-setup" && mode !== "change-password") && (mode !== "register" || registrationStep === "details") && (
            <label>{uk ? "Email" : "Email"}<input type="email" autoComplete="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          )}
          {mode === "register" && registrationStep === "details" && (
            <label>{uk ? "Ім’я" : "Name"}<input autoComplete="name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          )}
          {mode === "login" && <label>{uk ? "Пароль" : "Password"}<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
          {mode === "register" && registrationStep === "verify-email" && <label>{uk ? "Код із першого листа" : "Code from the first email"}<input inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value)} /></label>}
          {((mode === "register" && registrationStep === "set-password") || (mode === "forgot" && registrationStep === "set-password") || mode === "password-setup" || mode === "change-password") && (
            <>
              <label>{uk ? "Одноразовий код" : "One-time code"}<input inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value)} /></label>
              <label>{uk ? "Новий пароль" : "New password"}<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <label>{uk ? "Повторіть пароль" : "Repeat password"}<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
            </>
          )}
          {error && <p className={styles.error} role="alert">{error}</p>}
          {notice && <p className={styles.notice} role="status">{notice}</p>}
          <button type="submit" disabled={busy}>{busy ? (uk ? "Зачекайте…" : "Please wait…") : mode === "login" ? (uk ? "Увійти" : "Sign in") : mode === "register" && registrationStep === "details" ? (uk ? "Надіслати код" : "Send code") : mode === "register" && registrationStep === "verify-email" ? (uk ? "Підтвердити email" : "Verify email") : mode === "register" ? (uk ? "Створити пароль" : "Create password") : (uk ? "Змінити пароль" : "Change password")}</button>
        </form>
        {(mode === "forgot" || mode === "password-setup" || mode === "change-password" || (mode === "register" && registrationStep !== "details")) && <button type="button" className={styles.secondary} disabled={busy} onClick={requestOtp}>{uk ? "Надіслати новий код" : "Send a new code"}</button>}
        {mode === "change-password" && <button type="button" className={styles.secondary} disabled={busy} onClick={signOut}>{uk ? "Вийти з акаунта" : "Sign out"}</button>}
        <nav className={styles.links} aria-label={uk ? "Обліковий запис" : "Account"}>
          {mode === "login" && <><Link href="/register">{uk ? "Створити акаунт" : "Create account"}</Link><Link href="/forgot-password">{uk ? "Забули пароль?" : "Forgot password?"}</Link></>}
          {mode !== "login" && <Link href="/login">{uk ? "Повернутися до входу" : "Back to sign in"}</Link>}
        </nav>
      </section>
    </main>
  );
}
