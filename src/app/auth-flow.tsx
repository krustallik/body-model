"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/i18n-provider";
import { AUTH_OTP_EXPIRES_IN_SECONDS, AUTH_OTP_UI_RESEND_DELAY_SECONDS } from "@/modules/auth/policy";
import styles from "./auth.module.css";

type AuthMode = "login" | "register" | "registration-password" | "forgot" | "password-setup" | "change-password";
type FlowStep = "details" | "verify-email" | "set-password" | "complete";
type AuthFlowProps = { mode: AuthMode; signedInEmail?: string };

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes + ":" + String(remainder).padStart(2, "0");
}

function passwordSteps(mode: AuthMode, step: FlowStep, uk: boolean): Array<{ label: string; state: "done" | "current" | "upcoming" }> {
  const labels = mode === "register" || mode === "registration-password"
    ? uk ? ["Дані", "Підтвердження email", "Пароль"] : ["Details", "Verify email", "Password"]
    : mode === "forgot"
      ? uk ? ["Запит коду", "Новий пароль"] : ["Request code", "New password"]
      : uk ? ["Підтвердження", "Новий пароль"] : ["Confirm identity", "New password"];
  const index = mode === "registration-password" ? 2 : mode === "register"
    ? step === "details" ? 0 : step === "verify-email" ? 1 : step === "set-password" ? 2 : 3
    : step === "details" ? 0 : step === "set-password" ? 1 : 2;
  return labels.map((label, position) => ({
    label,
    state: position < index ? "done" : position === index ? "current" : "upcoming",
  }));
}

export function AuthFlow({ mode, signedInEmail }: AuthFlowProps) {
  const router = useRouter();
  const { locale } = useI18n();
  const uk = locale === "uk";
  const [email, setEmail] = useState(signedInEmail ?? "");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<FlowStep>(mode === "registration-password" ? "set-password" : "details");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  const expirySeconds = codeExpiresAt === null ? 0 : Math.max(0, Math.ceil((codeExpiresAt - clock) / 1000));
  const resendSeconds = resendAvailableAt === null ? 0 : Math.max(0, Math.ceil((resendAvailableAt - clock) / 1000));
  const codeIsActive = expirySeconds > 0;
  const isInitialPasswordSetup = mode === "registration-password" || (mode === "register" && step === "set-password");

  useEffect(() => {
    if (codeExpiresAt === null && resendAvailableAt === null) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [codeExpiresAt, resendAvailableAt]);

  function markCodeSent(): void {
    const now = Date.now();
    setClock(now);
    setCodeExpiresAt(now + AUTH_OTP_EXPIRES_IN_SECONDS * 1000);
    setResendAvailableAt(now + AUTH_OTP_UI_RESEND_DELAY_SECONDS * 1000);
    setOtp("");
  }

  async function post(path: string, body: unknown = {}): Promise<Response> {
    return fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  }

  function explainFailure(response: Response, fallback: string): Error {
    if (response.status === 429) {
      const seconds = Math.max(1, Number(response.headers.get("retry-after")) || 60);
      setResendAvailableAt(Date.now() + seconds * 1000);
      return new Error((uk ? "Забагато запитів. Спробуйте ще раз через " : "Too many requests. Try again in ") + seconds + (uk ? " с." : " seconds."));
    }
    return new Error(fallback);
  }

  async function openAccount(): Promise<void> {
    const response = await fetch("/api/account/bootstrap-status", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error(uk ? "Не вдалося перевірити стан акаунта." : "Unable to check account status.");
    const state = await response.json() as { passwordChangeRequired: boolean; onboardingRequired: boolean };
    router.replace(state.passwordChangeRequired ? "/password-setup" : state.onboardingRequired ? "/onboarding" : "/dashboard");
    router.refresh();
  }

  async function requestCode(): Promise<void> {
    if (resendSeconds > 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const path = mode === "password-setup" || mode === "change-password"
        ? "/api/account/password-change/request"
        : mode === "register" && step === "verify-email"
          ? "/api/registration/resend"
          : "/api/registration/password-reset/request";
      const body = path === "/api/account/password-change/request" ? {} : {
        email: email.trim().toLowerCase(),
        ...(mode === "register" && step === "verify-email" ? { name: name.trim() } : {}),
      };
      const response = await post(path, body);
      if (!response.ok) throw explainFailure(
        response,
        uk ? "Не вдалося надіслати код. Перевірте адресу й спробуйте пізніше." : "We could not send a code. Check the address and try again later.",
      );
      if (mode !== "register" || step !== "verify-email") setStep("set-password");
      markCodeSent();
      setNotice(uk
        ? "Якщо акаунт може виконати цю дію, BodyCast надішле код. Код діє 5 хвилин; повторний запит доступний через 30 секунд."
        : "If this account is eligible, BodyCast will send a code. It is valid for 5 minutes; you can request another in 30 seconds.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (uk ? "Сталася помилка." : "Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "login") {
        const response = await post("/api/account/login", { email: email.trim().toLowerCase(), password });
        if (!response.ok) throw explainFailure(response, uk ? "Не вдалося увійти. Перевірте email і пароль." : "Unable to sign in. Check your email and password.");
        await openAccount();
        return;
      }

      if (mode === "register" && step === "details") {
        const response = await post("/api/registration/start", { email: email.trim().toLowerCase(), name: name.trim() });
        if (!response.ok) throw explainFailure(response, uk ? "Реєстрація тимчасово недоступна. Спробуйте пізніше." : "Registration is temporarily unavailable. Try again later.");
        setStep("verify-email");
        markCodeSent();
        setNotice(uk
          ? "Якщо цю адресу можна зареєструвати, ми надіслали код. Перевірте пошту та введіть його нижче. Код діє 5 хвилин."
          : "If this address can be registered, we sent a code. Check your inbox and enter it below. The code is valid for 5 minutes.");
        return;
      }

      if (mode === "forgot" && step === "details") {
        await requestCode();
        return;
      }
      if ((mode === "change-password" || mode === "password-setup") && step === "details") {
        await requestCode();
        return;
      }

      if (mode === "register" && step === "verify-email") {
        if (!codeIsActive) throw new Error(uk ? "Код сплив. Запросіть новий код." : "This code has expired. Request a new one.");
        const response = await post("/api/auth/email-otp/verify-email", { email: email.trim().toLowerCase(), otp });
        if (!response.ok) throw explainFailure(response, uk ? "Код не підійшов. Перевірте останній лист або надішліть новий код." : "That code did not match. Check the latest email or request a new code.");
        const bootstrap = await fetch("/api/account/bootstrap-status", { cache: "no-store", credentials: "same-origin" });
        if (!bootstrap.ok) throw new Error(uk ? "Email підтверджено, але не вдалося продовжити налаштування." : "Email verified, but setup could not continue.");
        const accountState = await bootstrap.json() as { passwordChangeRequired: boolean };
        if (accountState.passwordChangeRequired) {
          await openAccount();
          return;
        }
        setStep("set-password");
        setCodeExpiresAt(null);
        setResendAvailableAt(null);
        setOtp("");
        setNotice(uk
          ? "Email підтверджено. Створіть пароль, щоб завершити реєстрацію."
          : "Email verified. Create a password to finish registration.");
        return;
      }

      if (isInitialPasswordSetup) {
        if (password.length < 12 || password.length > 128) {
          throw new Error(uk ? "Пароль має містити від 12 до 128 символів." : "Use a password between 12 and 128 characters.");
        }
        if (password !== confirmation) throw new Error(uk ? "Паролі не збігаються." : "Passwords do not match.");
        const response = await post("/api/registration/password-setup", { password });
        if (!response.ok) throw explainFailure(response, uk
          ? "Не вдалося створити пароль у цій сесії. Спробуйте увійти або відновити пароль."
          : "Password setup could not be completed in this session. Try signing in or resetting the password.");
        await openAccount();
        return;
      }

      if (step === "set-password") {
        if (!codeIsActive) throw new Error(uk ? "Код сплив. Запросіть новий код." : "This code has expired. Request a new one.");
        if (password.length < 12 || password.length > 128) {
          throw new Error(uk ? "Пароль має містити від 12 до 128 символів." : "Use a password between 12 and 128 characters.");
        }
        if (password !== confirmation) throw new Error(uk ? "Паролі не збігаються." : "Passwords do not match.");
        const response = mode === "password-setup" || mode === "change-password"
          ? await post("/api/account/password-change", { otp, password })
          : await post("/api/registration/password-reset", { email: email.trim().toLowerCase(), otp, password });
        if (!response.ok) throw explainFailure(response, uk
          ? "Код недійсний або сплив. Перевірте останній лист чи надішліть новий код."
          : "The code is invalid or expired. Check the latest email or request another.");

        setStep("complete");
        setCodeExpiresAt(null);
        setResendAvailableAt(null);
        setOtp("");
        setPassword("");
        setConfirmation("");
        setNotice(uk
          ? "Пароль оновлено, а поточний сеанс завершено. Увійдіть із новим паролем."
          : "Your password was updated and this session has ended. Sign in with the new password.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (uk ? "Сталася помилка." : "Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  const isPasswordChange = mode === "change-password" || mode === "password-setup";
  const isCodeStep = (mode === "register" && step === "verify-email")
    || (mode === "forgot" && step === "set-password")
    || (isPasswordChange && step === "set-password");
  const isCodeStageReady = isCodeStep && codeExpiresAt !== null;
  const steps = passwordSteps(mode, step, uk);
  const title = mode === "login" ? (uk ? "Увійти в BodyCast" : "Sign in to BodyCast")
    : mode === "register" ? (uk ? "Створити акаунт" : "Create your account")
      : mode === "registration-password" ? (uk ? "Створіть пароль" : "Create your password")
      : mode === "forgot" ? (uk ? "Відновити пароль" : "Reset your password")
        : mode === "change-password" ? (uk ? "Змінити пароль" : "Change your password")
          : (uk ? "Створіть пароль" : "Set your password");
  const submitLabel = mode === "login" ? (uk ? "Увійти" : "Sign in")
    : mode === "register" && step === "details" ? (uk ? "Надіслати код" : "Send verification code")
      : mode === "register" && step === "verify-email" ? (uk ? "Підтвердити email" : "Verify email")
        : isInitialPasswordSetup ? (uk ? "Створити пароль" : "Create password")
          : mode === "forgot" && step === "details" ? (uk ? "Надіслати код для відновлення" : "Send password reset code")
            : isPasswordChange && step === "details" ? (uk ? "Надіслати код на email" : "Send code to email")
              : (uk ? "Зберегти новий пароль" : "Save new password");

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="auth-title">
        <Link href="/" className={styles.brand}>
          BodyCast
          <span>{uk ? "Особистий простір здоров’я" : "Personal health workspace"}</span>
        </Link>
        <p className={styles.eyebrow}>{uk ? "Акаунт і безпека" : "Account and security"}</p>
        <h1 id="auth-title">{step === "complete" ? (uk ? "Пароль оновлено" : "Password updated") : title}</h1>

        {mode !== "login" && mode !== "forgot" && (
          <ol className={styles.stepList} aria-label={uk ? "Кроки" : "Steps"}>
            {steps.map((item, index) => (
              <li key={item.label} className={styles[item.state]}>
                <span className={styles.stepNumber} aria-hidden="true">{item.state === "done" ? "✓" : index + 1}</span>
                <span>{item.label}</span>
                <span className={styles.stepStatus}>{item.state === "current" ? (uk ? "Зараз" : "Current") : item.state === "done" ? (uk ? "Готово" : "Done") : ""}</span>
              </li>
            ))}
          </ol>
        )}

        {mode === "login" && <p className={styles.description}>{uk ? "Введіть email і пароль, щоб продовжити до свого профілю." : "Enter your email and password to continue to your profile."}</p>}
        {(mode === "register" && step === "details") && <p className={styles.description}>{uk ? "Спочатку підтвердимо адресу, потім ви створите пароль. Профіль з’явиться після підтвердження email." : "First verify your email, then create a password. Your profile is created only after email verification."}</p>}
        {mode === "register" && step === "verify-email" && <p className={styles.description}>{uk ? "Введіть код із листа, щоб підтвердити адресу." : "Enter the code from your email to verify the address."}</p>}
        {isInitialPasswordSetup && <p className={styles.description}>{uk ? "Email підтверджено. Створіть пароль для входу у свій акаунт." : "Email verified. Create a password for your account."}</p>}
        {isInitialPasswordSetup && <p className={styles.recipient}>{uk ? "Підтверджена адреса" : "Verified email"}: <strong>{signedInEmail ?? email}</strong></p>}
        {mode === "forgot" && step === "details" && <p className={styles.description}>{uk ? "Надішлемо одноразовий код, якщо адреса належить активному акаунту." : "We will send a one-time code if this address belongs to an active account."}</p>}
        {isPasswordChange && step === "details" && (
          <div className={styles.identityNotice}>
            <p>{uk ? "Для підтвердження надішлемо одноразовий код на email вашого акаунта." : "To confirm this change, we will send a one-time code to your account email."}</p>
            {signedInEmail && <strong>{signedInEmail}</strong>}
            <small>{uk ? "Цей код підтверджує доступ до пошти й не є багатофакторною автентифікацією." : "This code confirms access to your email; it is not multi-factor authentication."}</small>
          </div>
        )}
        {isPasswordChange && step === "set-password" && <p className={styles.description}>{uk ? "Код надіслано на email акаунта. Після зміни пароль буде оновлено, а сеанс завершено." : "A code was sent to your account email. After the change, your password is updated and your session ends."}</p>}
        {mode === "forgot" && step === "set-password" && <p className={styles.description}>{uk ? "Якщо акаунт існує, ми надіслали код. Після зміни пароля увійдіть знову." : "If the account exists, we sent a code. Sign in again after resetting the password."}</p>}

        {step === "complete" ? (
          <div className={styles.completion} role="status">
            <p className={styles.success}>{notice}</p>
            <Link className={styles.primaryLink} href="/login">{uk ? "Перейти до входу" : "Continue to sign in"}</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className={styles.form}>
            {(mode === "login" || (mode === "register" && step === "details") || (mode === "forgot" && step === "details")) && (
              <label className={styles.field}>
                <span>Email</span>
                <input type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
            )}
            {mode === "register" && step === "details" && (
              <label className={styles.field}>
                <span>{uk ? "Ім’я" : "Name"}</span>
                <input autoComplete="name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
              </label>
            )}
            {mode === "login" && (
              <div className={styles.field}>
                <label htmlFor="auth-current-password">{uk ? "Пароль" : "Password"}</label>
                <PasswordControl id="auth-current-password" autoComplete="current-password" value={password} onChange={setPassword} visible={showPassword} setVisible={setShowPassword} uk={uk} required />
              </div>
            )}
            {isCodeStageReady && (
              <>
                <p className={styles.recipient}>{uk ? "Код надіслано на" : "Code sent to"} <strong>{isPasswordChange ? signedInEmail : email}</strong></p>
                <label className={styles.field}>
                  <span>{mode === "register" && step === "verify-email" ? (uk ? "Код підтвердження email" : "Email verification code") : (uk ? "Одноразовий код із листа" : "One-time code from email")}</span>
                  <input inputMode="numeric" autoComplete="one-time-code" type="text" pattern="[0-9]{6}" required minLength={6} maxLength={6} aria-label={uk ? "Шестизначний код із листа" : "Six-digit email code"} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} />
                  <span className={styles.codeMeta} aria-live="polite">
                    {codeIsActive
                      ? (uk ? "Код діє ще " + formatTime(expirySeconds) + "." : "Code expires in " + formatTime(expirySeconds) + ".")
                      : (uk ? "Код сплив. Надішліть новий." : "Code expired. Request a new one.")}
                  </span>
                </label>
              </>
            )}
            {(isInitialPasswordSetup || (step === "set-password" && isCodeStageReady)) && (
              <>
                <div className={styles.field}>
                  <label htmlFor="auth-new-password">{uk ? "Новий пароль" : "New password"}</label>
                  <PasswordControl id="auth-new-password" autoComplete="new-password" value={password} onChange={setPassword} visible={showPassword} setVisible={setShowPassword} uk={uk} required minLength={12} maxLength={128} />
                  <span className={styles.codeMeta}>{uk ? "12–128 символів. Можна використати менеджер паролів." : "12–128 characters. Password managers are supported."}</span>
                </div>
                <div className={styles.field}>
                  <label htmlFor="auth-confirm-new-password">{uk ? "Повторіть новий пароль" : "Confirm new password"}</label>
                  <PasswordControl id="auth-confirm-new-password" autoComplete="new-password" value={confirmation} onChange={setConfirmation} visible={showConfirmation} setVisible={setShowConfirmation} uk={uk} required minLength={12} maxLength={128} />
                </div>
              </>
            )}
            {error && <p className={styles.error} role="alert">{error}</p>}
            {notice && <p className={styles.notice} role="status">{notice}</p>}
            <button className={styles.primary} type="submit" disabled={busy || (isCodeStep && (!isCodeStageReady || !codeIsActive))}>
              {busy ? (uk ? "Зачекайте…" : "Please wait…") : submitLabel}
            </button>
          </form>
        )}

        {isCodeStep && (
          <div className={styles.codeActions}>
            <button type="button" className={styles.secondary} disabled={busy || resendSeconds > 0} onClick={() => void requestCode()}>
              {busy
                ? (uk ? "Надсилання…" : "Sending…")
                : resendSeconds > 0
                  ? (uk ? "Повторно надіслати через " + resendSeconds + " с" : "Resend in " + resendSeconds + "s")
                  : codeExpiresAt === null
                    ? (uk ? "Надіслати код" : "Send code")
                    : (uk ? "Надіслати код повторно" : "Resend code")}
            </button>
            {mode === "register" && step === "verify-email" && (
              <button type="button" className={styles.textButton} disabled={busy} onClick={() => {
                setStep("details");
                setOtp("");
                setCodeExpiresAt(null);
                setResendAvailableAt(null);
                setNotice(null);
                setError(null);
              }}>
                {uk ? "Змінити email" : "Change email"}
              </button>
            )}
          </div>
        )}

        <nav className={styles.links} aria-label={uk ? "Навігація акаунта" : "Account navigation"}>
          {mode === "login" && <><Link href="/register">{uk ? "Створити акаунт" : "Create an account"}</Link><Link href="/forgot-password">{uk ? "Забули пароль?" : "Forgot password?"}</Link></>}
          {mode === "register" && step === "details" && <Link href="/login">{uk ? "Уже є акаунт? Увійти" : "Already have an account? Sign in"}</Link>}
          {(mode === "forgot" || mode === "password-setup" || mode === "register" && step !== "details") && <Link href="/login">{uk ? "Повернутися до входу" : "Back to sign in"}</Link>}
          {mode === "change-password" && <Link href="/settings/profile">{uk ? "Повернутися до профілю" : "Back to profile"}</Link>}
        </nav>
      </section>
    </main>
  );
}

function PasswordControl({
  id,
  autoComplete,
  value,
  onChange,
  visible,
  setVisible,
  uk,
  required,
  minLength,
  maxLength,
}: {
  id: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  setVisible: (value: boolean) => void;
  uk: boolean;
  required: boolean;
  minLength?: number;
  maxLength?: number;
}) {
  return (
    <span className={styles.passwordControl}>
      <input id={id} type={visible ? "text" : "password"} autoComplete={autoComplete} required={required} minLength={minLength} maxLength={maxLength} value={value} onChange={(event) => onChange(event.target.value)} />
      <button type="button" className={styles.passwordToggle} aria-pressed={visible} onClick={() => setVisible(!visible)}>
        {visible ? (uk ? "Сховати" : "Hide") : (uk ? "Показати" : "Show")}
      </button>
    </span>
  );
}
