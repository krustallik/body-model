/**
 * Presentation-only coaching copy for Training Diary exercise screens.
 * Not scientific muscle coefficients — UX labels and short cues only.
 */
export type ExerciseInfoCopy = {
  primaryMusclesUk: string;
  primaryMusclesEn: string;
  secondaryMusclesUk?: string;
  secondaryMusclesEn?: string;
  cuesUk: string[];
  cuesEn: string[];
};

const EXERCISE_INFO_BY_CATALOG_NAME: Record<string, ExerciseInfoCopy> = {
  "Жим гантелей на похилій лаві вгору (30°)": {
    primaryMusclesUk: "верх грудей, передні дельти",
    primaryMusclesEn: "upper chest, front delts",
    secondaryMusclesUk: "трицепси",
    secondaryMusclesEn: "triceps",
    cuesUk: [
      "тримайте лопатки стабільно на лаві",
      "контролюйте негативну фазу",
      "не розводьте лікті надмірно",
    ],
    cuesEn: [
      "keep shoulder blades stable on the bench",
      "control the eccentric",
      "don’t flare elbows excessively",
    ],
  },
  "Розведення гантелей на горизонтальній лаві": {
    primaryMusclesUk: "груди",
    primaryMusclesEn: "chest",
    secondaryMusclesUk: "передні дельти",
    secondaryMusclesEn: "front delts",
    cuesUk: [
      "зберігайте легкий згин у ліктях",
      "опускайте до комфортного розтягнення",
      "не ударяйте гантелями зверху",
    ],
    cuesEn: [
      "keep a soft elbow bend",
      "lower to a comfortable stretch",
      "don’t bang the dumbbells at the top",
    ],
  },
  "Віджимання від ручок": {
    primaryMusclesUk: "груди, трицепси, передні дельти",
    primaryMusclesEn: "chest, triceps, front delts",
    cuesUk: [
      "тримайте корпус рівною лінією",
      "опускайте груди між ручками",
      "не провалюйте поперек",
    ],
    cuesEn: [
      "keep a straight body line",
      "lower the chest between the handles",
      "don’t sag the lower back",
    ],
  },
  "Жим гантелей сидячи": {
    primaryMusclesUk: "дельти",
    primaryMusclesEn: "delts",
    secondaryMusclesUk: "трицепси, верх грудей",
    secondaryMusclesEn: "triceps, upper chest",
    cuesUk: [
      "притисніть спину до спинки",
      "тисніть майже вертикально вгору",
      "не вигинайте поперек",
    ],
    cuesEn: [
      "keep your back against the pad",
      "press nearly vertical",
      "don’t arch the lower back",
    ],
  },
  "Махи гантеллю однією рукою вбік": {
    primaryMusclesUk: "середні дельти",
    primaryMusclesEn: "side delts",
    cuesUk: [
      "піднімайте до рівня плеча",
      "не використовуйте інерцію корпусу",
      "тримайте зап’ястя нейтрально",
    ],
    cuesEn: [
      "raise to shoulder height",
      "don’t swing the torso",
      "keep a neutral wrist",
    ],
  },
  "Розгинання однієї руки в блоці": {
    primaryMusclesUk: "трицепс",
    primaryMusclesEn: "triceps",
    cuesUk: [
      "фіксуйте лікоть біля корпусу",
      "повністю розгинайте, без ривка",
      "контролюйте повернення вгору",
    ],
    cuesEn: [
      "pin the elbow by your side",
      "extend fully without jerking",
      "control the return",
    ],
  },
  "Розгинання однієї руки з гантеллю в нахилі": {
    primaryMusclesUk: "трицепс",
    primaryMusclesEn: "triceps",
    cuesUk: [
      "плече паралельне підлозі",
      "рухайте лише передпліччя",
      "не розгойдуйте корпус",
    ],
    cuesEn: [
      "upper arm parallel to the floor",
      "move only the forearm",
      "don’t swing the torso",
    ],
  },
  "Тяга горизонтального блоку сидячи однією рукою": {
    primaryMusclesUk: "найширші, середня спина",
    primaryMusclesEn: "lats, mid-back",
    secondaryMusclesUk: "біцепс, задні дельти",
    secondaryMusclesEn: "biceps, rear delts",
    cuesUk: [
      "тягніть лікоть назад до пояса",
      "тримайте корпус стабільно",
      "не округлюйте верх спини",
    ],
    cuesEn: [
      "drive the elbow back to the hip",
      "keep the torso steady",
      "don’t round the upper back",
    ],
  },
  "Гіперекстензія": {
    primaryMusclesUk: "розгиначі спини, сідниці, задня поверхня стегна",
    primaryMusclesEn: "spinal erectors, glutes, hamstrings",
    cuesUk: [
      "піднімайте до прямої лінії тіла",
      "не перерозгинайте поперек",
      "контролюйте опускання",
    ],
    cuesEn: [
      "rise to a straight body line",
      "don’t hyperextend the lower back",
      "control the descent",
    ],
  },
  "Згинання однієї руки від коліна": {
    primaryMusclesUk: "біцепс",
    primaryMusclesEn: "biceps",
    cuesUk: [
      "ліктьовий упор на внутрішню стегна",
      "не розгойдуйте плече",
      "повний контроль униз",
    ],
    cuesEn: [
      "brace the elbow on the inner thigh",
      "don’t swing the shoulder",
      "control the lowering phase",
    ],
  },
  "Згинання рук з розворотом сидячи на похилій лаві": {
    primaryMusclesUk: "біцепс",
    primaryMusclesEn: "biceps",
    secondaryMusclesUk: "плечовий м’яз",
    secondaryMusclesEn: "brachialis",
    cuesUk: [
      "притисніть лопатки до лави",
      "супінуйте кисть у верхній точці",
      "не підкидайте вагу корпусом",
    ],
    cuesEn: [
      "keep shoulder blades on the bench",
      "supinate at the top",
      "don’t cheat with the torso",
    ],
  },
  "Згинання кисті з гантеллю в упорі": {
    primaryMusclesUk: "згиначі передпліччя",
    primaryMusclesEn: "forearm flexors",
    cuesUk: [
      "передпліччя щільно на лаві",
      "рухайте лише кисть",
      "повний діапазон без ривка",
    ],
    cuesEn: [
      "forearm flat on the bench",
      "move only the wrist",
      "full range without jerking",
    ],
  },
};

export function resolveExerciseInfo(input: {
  catalogName?: string | null;
  snapshotExerciseName?: string | null;
}): ExerciseInfoCopy | null {
  const candidates = [input.catalogName, input.snapshotExerciseName]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  for (const name of candidates) {
    const exact = EXERCISE_INFO_BY_CATALOG_NAME[name];
    if (exact) return exact;
  }
  return null;
}
