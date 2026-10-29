"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import styles from "./profile.module.css";

type ApiKeyRecord = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type ApiKeyResponse = { key?: ApiKeyRecord & { token: string }; error?: string };

async function responseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function fetchKeyRecords(uk: boolean, signal?: AbortSignal): Promise<ApiKeyRecord[]> {
  const response = await fetch("/api/v1/profile/api-keys", { cache: "no-store", signal });
  if (!response.ok) throw new Error(uk ? "Не вдалося завантажити ключі." : "Unable to load keys.");
  const body = await responseJson<{ keys: ApiKeyRecord[] }>(response);
  return body.keys;
}

export function ProfileApiKeys() {
  const { locale } = useI18n();
  const uk = locale === "uk";
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [name, setName] = useState("Apple Shortcut");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; token: string } | null>(null);

  const refreshKeys = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setKeys(await fetchKeyRecords(uk, signal));
  }, [uk]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchKeyRecords(uk, controller.signal)
      .then((nextKeys) => {
        if (!controller.signal.aborted) setKeys(nextKeys);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Unable to load keys");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [uk]);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("create");
    setError(null);
    setNotice(null);
    setRevealed(null);
    try {
      const response = await fetch("/api/v1/profile/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await responseJson<ApiKeyResponse>(response);
      if (!response.ok || !body.key) throw new Error(uk ? "Не вдалося створити ключ." : "Unable to create key.");
      setRevealed({ id: body.key.id, token: body.key.token });
      setNotice(uk ? "Ключ створено. Скопіюйте його зараз — повторно показати секрет не можна." : "Key created. Copy it now; the secret cannot be shown again.");
      await refreshKeys();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : (uk ? "Не вдалося створити ключ." : "Unable to create key."));
    } finally {
      setPending(null);
    }
  }

  async function rotateKey(key: ApiKeyRecord) {
    setPending(key.id);
    setError(null);
    setNotice(null);
    setRevealed(null);
    try {
      const response = await fetch("/api/v1/profile/api-keys", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: key.id }),
      });
      const body = await responseJson<ApiKeyResponse>(response);
      if (!response.ok || !body.key) throw new Error(uk ? "Не вдалося замінити ключ." : "Unable to rotate key.");
      setRevealed({ id: body.key.id, token: body.key.token });
      setNotice(uk ? "Старий ключ відкликано, новий створено. Замініть його в Apple Shortcut." : "The old key was revoked and a new one created. Replace it in Apple Shortcut.");
      await refreshKeys();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : (uk ? "Не вдалося замінити ключ." : "Unable to rotate key."));
    } finally {
      setPending(null);
    }
  }

  async function revokeKey(key: ApiKeyRecord) {
    setPending(key.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/v1/profile/api-keys", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: key.id }),
      });
      if (!response.ok) throw new Error(uk ? "Не вдалося відкликати ключ." : "Unable to revoke key.");
      if (revealed?.id === key.id) setRevealed(null);
      setNotice(uk ? "Ключ відкликано." : "Key revoked.");
      await refreshKeys();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : (uk ? "Не вдалося відкликати ключ." : "Unable to revoke key."));
    } finally {
      setPending(null);
    }
  }

  async function copyKey() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.token);
      setNotice(uk ? "Ключ скопійовано. Вставте його в заголовок x-api-key у Shortcut." : "Key copied. Paste it into the x-api-key header in Shortcut.");
    } catch {
      setError(uk ? "Не вдалося скопіювати. Виділіть ключ і скопіюйте вручну." : "Copy failed. Select and copy the key manually.");
    }
  }

  const date = (value: string) => new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en", { dateStyle: "medium" }).format(new Date(value));

  return (
    <section className={styles.card} aria-labelledby="sync-keys-title">
      <div className={styles.cardHeading}>
        <div>
          <p className={styles.eyebrow}>{uk ? "Синхронізація" : "Sync access"}</p>
          <h2 id="sync-keys-title">{uk ? "Персональні ключі API" : "Personal API keys"}</h2>
        </div>
        <p>{uk ? "Ключі працюють лише з вашим профілем." : "Keys are scoped to your Profile."}</p>
      </div>
      <div className={styles.keyBody}>
        <p className={styles.keyHint}>
          {uk
            ? "Створіть окремий ключ для Apple Shortcut. Секрет показується лише під час створення або заміни. У Shortcut замініть тільки значення заголовка x-api-key."
            : "Create a personal key for Apple Shortcut. The secret is shown only when created or rotated. Replace only the x-api-key header value in the Shortcut."}
        </p>
        <form className={styles.keyForm} onSubmit={createKey}>
          <label className={styles.field}>
            <span>{uk ? "Назва ключа" : "Key name"}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} />
          </label>
          <button type="submit" disabled={loading || pending !== null || !name.trim()}>
            {pending === "create" ? (uk ? "Створення…" : "Creating…") : (uk ? "Створити ключ" : "Create key")}
          </button>
        </form>

        {revealed && (
          <div className={styles.keyReveal} aria-label={uk ? "Новий секрет ключа" : "New key secret"}>
            <code>{revealed.token}</code>
            <button type="button" onClick={copyKey}>{uk ? "Скопіювати ключ" : "Copy key"}</button>
          </div>
        )}
        {notice && <p className={styles.keySuccess} role="status">{notice}</p>}
        {error && <p className={styles.keyError} role="alert">{error}</p>}

        {loading ? (
          <p className={styles.keyHint} aria-live="polite">{uk ? "Завантаження ключів…" : "Loading keys…"}</p>
        ) : keys.length === 0 ? (
          <p className={styles.keyHint}>{uk ? "Персональних ключів ще немає." : "No personal keys yet."}</p>
        ) : (
          <ul className={styles.keyList}>
            {keys.map((key) => (
              <li className={styles.keyItem} key={key.id}>
                <div className={styles.keyMeta}>
                  <strong>{key.name}</strong>
                  <span className={key.revokedAt ? styles.keyRevoked : undefined}>{key.revokedAt ? (uk ? "Відкликано" : "Revoked") : (uk ? "Активний" : "Active")}</span>
                  <small>{uk ? "Створено" : "Created"}: {date(key.createdAt)}{key.lastUsedAt ? ` · ${uk ? "Використано" : "Last used"}: ${date(key.lastUsedAt)}` : ""}</small>
                </div>
                {!key.revokedAt && (
                  <div className={styles.keyActions}>
                    <button type="button" aria-label={uk ? `Замінити ключ ${key.name}` : `Rotate ${key.name} key`} disabled={pending !== null} onClick={() => void rotateKey(key)}>
                      {pending === key.id ? (uk ? "Заміна…" : "Rotating…") : (uk ? "Замінити" : "Rotate")}
                    </button>
                    <button className={styles.keyRevoke} type="button" aria-label={uk ? `Відкликати ключ ${key.name}` : `Revoke ${key.name} key`} disabled={pending !== null} onClick={() => void revokeKey(key)}>
                      {pending === key.id ? (uk ? "Обробка…" : "Working…") : (uk ? "Відкликати" : "Revoke")}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
