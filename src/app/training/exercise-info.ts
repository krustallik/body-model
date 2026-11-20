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
  "Підтягування на перекладині": {
    primaryMusclesUk: "найширші, середня спина",
    primaryMusclesEn: "lats, mid-back",
    secondaryMusclesUk: "біцепси, передпліччя",
    secondaryMusclesEn: "biceps, forearms",
    cuesUk: [
      "починайте рух зі зведення та опускання лопаток",
      "тягніть груди до перекладини без розгойдування",
      "контролюйте повне опускання",
    ],
    cuesEn: [
      "initiate by setting the shoulder blades down and back",
      "pull the chest toward the bar without swinging",
      "control the full lowering phase",
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
  "Болгарські присідання з упором задньої ноги на лаву": {
    primaryMusclesUk: "квадрицепси, сідничні м’язи",
    primaryMusclesEn: "quadriceps, glutes",
    secondaryMusclesUk: "задня поверхня стегна, литкові м’язи, м’язи корпуса",
    secondaryMusclesEn: "hamstrings, calves, core",
    cuesUk: ["спирайтеся задньою ногою на лаву", "контролюйте опускання на передній нозі", "тримайте корпус стабільно"],
    cuesEn: ["rest the rear foot on a bench", "control the descent through the front leg", "keep the torso steady"],
  },
  "Випади вперед": {
    primaryMusclesUk: "квадрицепси, сідничні м’язи",
    primaryMusclesEn: "quadriceps, glutes",
    secondaryMusclesUk: "задня поверхня стегна, литкові м’язи, м’язи корпуса",
    secondaryMusclesEn: "hamstrings, calves, core",
    cuesUk: ["зробіть контрольований крок уперед", "опускайтеся без удару заднім коліном", "поверніться у вихідне положення поштовхом передньої ноги"],
    cuesEn: ["step forward under control", "lower without dropping the rear knee", "push through the front leg to return"],
  },
  "Присідання з гантеллю в руках": {
    primaryMusclesUk: "квадрицепси, сідничні м’язи",
    primaryMusclesEn: "quadriceps, glutes",
    secondaryMusclesUk: "привідні м’язи стегна, м’язи корпуса",
    secondaryMusclesEn: "hip adductors, core",
    cuesUk: ["утримуйте гантель перед грудьми", "опускайтеся в комфортну глибину", "зберігайте стопи повністю на підлозі"],
    cuesEn: ["hold the dumbbell in front of your chest", "squat to a comfortable depth", "keep both feet grounded"],
  },
  "Прямі скручування з гантеллю на прес": {
    primaryMusclesUk: "прямий м’яз живота",
    primaryMusclesEn: "rectus abdominis",
    secondaryMusclesUk: "косі м’язи живота",
    secondaryMusclesEn: "obliques",
    cuesUk: ["рухайте грудну клітку до таза", "піднімайте лопатки контрольовано", "не тягніть шию руками"],
    cuesEn: ["curl the rib cage toward the pelvis", "lift the shoulder blades under control", "do not pull on your neck"],
  },
  "Бокові скручування з гантеллю на прес": {
    primaryMusclesUk: "косі м’язи живота",
    primaryMusclesEn: "obliques",
    secondaryMusclesUk: "прямий м’яз живота",
    secondaryMusclesEn: "rectus abdominis",
    cuesUk: ["обертайте грудну клітку контрольовано", "рухайтеся корпусом, не смикайте гантель", "виконуйте повторення в обидва боки"],
    cuesEn: ["rotate the torso under control", "turn through the trunk instead of swinging the dumbbell", "perform repetitions on both sides"],
  },
  "Спліт-присідання з піднятою передньою стопою": {
    primaryMusclesUk: "квадрицепси, сідничні м’язи",
    primaryMusclesEn: "quadriceps, glutes",
    secondaryMusclesUk: "задня поверхня стегна, литкові м’язи",
    secondaryMusclesEn: "hamstrings, calves",
    cuesUk: ["поставте передню стопу на невисоку опору", "опускайтеся під контролем", "зберігайте рівновагу між сторонами"],
    cuesEn: ["place the front foot on a low platform", "lower under control", "keep balance consistent on both sides"],
  },
  "Румунська тяга (Romanian Deadlift)": {
    primaryMusclesUk: "задня поверхня стегна, сідничні м’язи",
    primaryMusclesEn: "hamstrings, glutes",
    secondaryMusclesUk: "розгиначі спини",
    secondaryMusclesEn: "spinal erectors",
    cuesUk: ["відводьте таз назад із м’яко зігнутими колінами", "тримайте штангу близько до ніг", "зупиніть опускання до втрати стабільного положення спини"],
    cuesEn: ["hinge at the hips with softly bent knees", "keep the bar close to your legs", "stop the descent before losing a stable back position"],
  },
  "Згинання ніг із нижнім блоком": {
    primaryMusclesUk: "задня поверхня стегна",
    primaryMusclesEn: "hamstrings",
    secondaryMusclesUk: "литкові м’язи",
    secondaryMusclesEn: "calves",
    cuesUk: ["закріпіть манжету на щиколотці", "згинайте коліно без ривка", "контролюйте повернення ноги"],
    cuesEn: ["secure the cuff at the ankle", "flex the knee without jerking", "control the leg as it returns"],
  },
  "Підйом таза зі штангою (Hip Thrust)": {
    primaryMusclesUk: "сідничні м’язи",
    primaryMusclesEn: "glutes",
    secondaryMusclesUk: "задня поверхня стегна",
    secondaryMusclesEn: "hamstrings",
    cuesUk: ["розташуйте верх спини на опорі", "піднімайте таз без перерозгинання попереку", "контролюйте опускання штанги"],
    cuesEn: ["set your upper back against the support", "raise the hips without overextending the lower back", "control the bar on the descent"],
  },
  "Відведення ноги назад із нижнім блоком": {
    primaryMusclesUk: "сідничні м’язи",
    primaryMusclesEn: "glutes",
    cuesUk: ["закріпіть манжету на щиколотці", "рухайте ногу назад із нерухомим тазом", "не прогинайте поперек"],
    cuesEn: ["secure the cuff at the ankle", "move the leg back while keeping the pelvis steady", "avoid arching the lower back"],
  },
  "Підйоми на носок стоячи на одній нозі": {
    primaryMusclesUk: "литкові м’язи",
    primaryMusclesEn: "calves",
    cuesUk: ["за потреби тримайтеся за опору", "піднімайте й опускайте п’яту контрольовано", "виконайте заплановані повторення з обох боків"],
    cuesEn: ["hold a support if needed", "raise and lower the heel under control", "complete the planned repetitions on both sides"],
  },
  "Підйоми на носок сидячи": {
    primaryMusclesUk: "литкові м’язи",
    primaryMusclesEn: "calves",
    cuesUk: ["розташуйте навантаження стабільно на стегнах", "рухайтеся через гомілковостопний суглоб", "контролюйте нижню точку"],
    cuesEn: ["keep the load stable on your thighs", "move through the ankles", "control the bottom position"],
  },
  "Приведення ноги на нижньому блоці": {
    primaryMusclesUk: "привідні м’язи стегна",
    primaryMusclesEn: "hip adductors",
    cuesUk: ["закріпіть манжету на щиколотці", "ведіть ногу контрольовано до середньої лінії", "утримуйте корпус нерухомо"],
    cuesEn: ["secure the cuff at the ankle", "move the leg under control toward the midline", "keep the torso steady"],
  },
  "Відведення ноги вбік на нижньому блоці": {
    primaryMusclesUk: "сідничні м’язи, відвідні м’язи стегна",
    primaryMusclesEn: "glutes, hip abductors",
    cuesUk: ["закріпіть манжету на щиколотці", "ведіть ногу вбік без повороту таза", "контролюйте повернення до опори"],
    cuesEn: ["secure the cuff at the ankle", "move the leg outward without rotating the pelvis", "control the return"],
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
