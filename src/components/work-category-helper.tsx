"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import { OCCUPATIONAL_CATEGORIES, type OccupationalCategory } from "@/model/occupational-activity";
import { occupationalCategoryCopy } from "@/modules/work-intervals/occupational-category-copy";
import { recommendWorkCategory, type WorkCategoryAnswers } from "@/modules/work-intervals/work-category-recommendation";
import styles from "./work-category-helper.module.css";

type QuestionKey = keyof WorkCategoryAnswers;
type Answer = WorkCategoryAnswers[QuestionKey];

const QUESTION_KEYS: QuestionKey[] = ["movement", "posture", "effort", "handling"];

const EN_QUESTIONS: Record<QuestionKey, { title: string; options: Array<{ value: Answer; label: string }> }> = {
  movement: { title: "How much do you move during most of a typical shift?", options: [
    { value: "stationary", label: "Mostly in one place" },
    { value: "some-walking", label: "Walk between tasks from time to time" },
    { value: "continuous", label: "Move frequently through most of the shift" },
    { value: "unsure", label: "It varies or I am not sure" },
  ] },
  posture: { title: "Which work positions best describe most of the shift?", options: [
    { value: "stable", label: "Mostly stable standing or light hand tasks" },
    { value: "reaching-bending", label: "Repeated reaching, bending, or changing position" },
    { value: "active-varied", label: "Frequent whole-body movement between tasks" },
    { value: "unsure", label: "It varies or I am not sure" },
  ] },
  effort: { title: "How physically demanding are the repeated tasks?", options: [
    { value: "low", label: "Little effort beyond standing and light movement" },
    { value: "repeated-light", label: "Regular effort, but usually light" },
    { value: "repeated-demanding", label: "Repeated demanding effort" },
    { value: "unsure", label: "It varies or I am not sure" },
  ] },
  handling: { title: "What do you usually carry, push, or pull?", options: [
    { value: "none-or-occasional-light", label: "None or occasional light items" },
    { value: "frequent-light", label: "Frequent handling of light items" },
    { value: "repeated-moderate", label: "Repeated moderate loads or forceful pushing/pulling" },
    { value: "unsure", label: "It varies or I am not sure" },
  ] },
};

const UK_QUESTIONS: Record<QuestionKey, { title: string; options: Array<{ value: Answer; label: string }> }> = {
  movement: { title: "Скільки ви рухаєтеся протягом типової зміни?", options: [
    { value: "stationary", label: "Переважно на одному місці" },
    { value: "some-walking", label: "Час від часу переходжу між завданнями" },
    { value: "continuous", label: "Багато рухаюся більшу частину зміни" },
    { value: "unsure", label: "Робота різна або не впевнений/не впевнена" },
  ] },
  posture: { title: "Які положення тіла найкраще описують більшу частину зміни?", options: [
    { value: "stable", label: "Переважно стояння або легка робота руками" },
    { value: "reaching-bending", label: "Часто тягнуся, нахиляюся або змінюю положення" },
    { value: "active-varied", label: "Часто рухаюся всім тілом між завданнями" },
    { value: "unsure", label: "Робота різна або не впевнений/не впевнена" },
  ] },
  effort: { title: "Яких зусиль потребують повторювані завдання?", options: [
    { value: "low", label: "Мало зусиль, окрім стояння та легких рухів" },
    { value: "repeated-light", label: "Регулярні, але переважно легкі зусилля" },
    { value: "repeated-demanding", label: "Повторювані значні фізичні зусилля" },
    { value: "unsure", label: "Робота різна або не впевнений/не впевнена" },
  ] },
  handling: { title: "Що ви зазвичай переносите, штовхаєте або тягнете?", options: [
    { value: "none-or-occasional-light", label: "Нічого або інколи легкі речі" },
    { value: "frequent-light", label: "Часто працюю з легкими предметами" },
    { value: "repeated-moderate", label: "Регулярно переношу помірно важке або сильно штовхаю/тягну" },
    { value: "unsure", label: "Робота різна або не впевнений/не впевнена" },
  ] },
};

export function WorkCategoryHelper({
  onRecommend,
  triggerClassName,
}: {
  onRecommend: (category: OccupationalCategory) => void;
  triggerClassName?: string;
}) {
  const { locale } = useI18n();
  const uk = locale === "uk";
  const questions = uk ? UK_QUESTIONS : EN_QUESTIONS;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const questionRef = useRef<HTMLLegendElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<WorkCategoryAnswers>>({});

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (step < QUESTION_KEYS.length) questionRef.current?.focus();
      else resultHeadingRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, step]);

  const category = Object.keys(answers).length === QUESTION_KEYS.length
    ? recommendWorkCategory(answers as WorkCategoryAnswers)
    : null;

  function next() {
    if (step < QUESTION_KEYS.length) setStep((current) => current + 1);
  }

  function close() {
    setOpen(false);
  }

  function acceptRecommendation() {
    if (!category) return;
    onRecommend(category);
    close();
  }

  return <>
    <button
      className={triggerClassName ?? styles.trigger}
      type="button"
      onClick={() => { setAnswers({}); setStep(0); setOpen(true); }}
    >{uk ? "Допомогти визначити рівень" : "Help me choose a level"}</button>
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="work-category-helper-title"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClose={close}
    >
      <div className={styles.content}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>{uk ? "Рекомендація характеру роботи" : "Work type guidance"}</p>
            <h2 id="work-category-helper-title">{uk ? "Опишіть типову зміну" : "Describe a typical shift"}</h2>
          </div>
          <button type="button" className={styles.close} aria-label={uk ? "Закрити" : "Close"} onClick={close}>×</button>
        </header>
        <p className={styles.intro}>{uk
          ? "Відповідайте про більшу частину зміни. Помічник запропонує лише одну з чотирьох наявних категорій; години, перерви й робочі дні залишаються окремими."
          : "Answer for most of the shift. The helper suggests only one of the four existing categories; hours, breaks, and work days stay separate."}</p>
        {step < QUESTION_KEYS.length ? (() => {
          const key = QUESTION_KEYS[step];
          const question = questions[key];
          return <div>
            <fieldset className={styles.question}>
              <legend ref={questionRef} tabIndex={-1} aria-live="polite"><span>{String(step + 1).padStart(2, "0")}</span>{question.title}</legend>
              <div className={styles.options}>
                {question.options.map((option) => (
                  <label className={styles.option} key={option.value}>
                    <input
                      type="radio"
                      name={`work-category-${key}`}
                      value={option.value}
                      checked={answers[key] === option.value}
                      onChange={() => setAnswers((current) => ({ ...current, [key]: option.value }))}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className={styles.actions}>
              {step > 0 && <button type="button" className={styles.secondary} onClick={() => setStep((current) => current - 1)}>{uk ? "Назад" : "Back"}</button>}
              <button type="button" className={styles.primary} disabled={!answers[key]} onClick={next}>{uk ? "Далі" : "Next"}</button>
            </div>
          </div>;
        })() : <section className={styles.result} aria-live="polite">
          {category ? <>
            <p className={styles.eyebrow}>{uk ? "Рекомендований рівень" : "Recommended level"}</p>
            <h3 ref={resultHeadingRef} tabIndex={-1}>{occupationalCategoryCopy(category, uk ? "uk" : "en").label}</h3>
            <p>{occupationalCategoryCopy(category, uk ? "uk" : "en").description}</p>
            <button type="button" className={styles.primary} onClick={acceptRecommendation}>{uk ? "Використати рекомендацію" : "Use recommendation"}</button>
          </> : <>
            <h3 ref={resultHeadingRef} tabIndex={-1}>{uk ? "Однозначної рекомендації немає" : "No clear recommendation"}</h3>
            <p>{uk
              ? "Відповіді різні або невизначені. Виберіть найближчий опис типової зміни вручну серед чотирьох категорій. Проміжного рівня немає."
              : "The answers are mixed or uncertain. Choose the closest typical-shift description manually from the four existing categories. There is no in-between level."}</p>
          </>}
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={() => setStep(0)}>{uk ? "Змінити відповіді" : "Change answers"}</button>
            <button type="button" className={styles.secondary} onClick={close}>{uk ? "Закрити" : "Close"}</button>
          </div>
        </section>}
      </div>
    </dialog>
  </>;
}

export function OccupationalCategoryDescriptions({ className }: { className?: string }) {
  const { locale } = useI18n();
  const uk = locale === "uk";
  const categories = Object.keys(OCCUPATIONAL_CATEGORIES) as OccupationalCategory[];
  return <details className={`${styles.descriptions} ${className ?? ""}`}>
    <summary>{uk ? "Пояснення чотирьох рівнів" : "What the four levels mean"}</summary>
    <ul>{categories.map((category) => {
      const copy = occupationalCategoryCopy(category, uk ? "uk" : "en");
      return <li key={category}><strong>{copy.label}</strong><span>{copy.description}</span></li>;
    })}</ul>
  </details>;
}
