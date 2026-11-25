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
    primaryMusclesUk: "груди (акцент на верхню частину)",
    primaryMusclesEn: "chest (upper-chest emphasis)",
    secondaryMusclesUk: "передні дельти, трицепси",
    secondaryMusclesEn: "front delts, triceps",
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
    primaryMusclesUk: "груди",
    primaryMusclesEn: "chest",
    secondaryMusclesUk: "трицепси, передні дельти, передній зубчастий м’яз",
    secondaryMusclesEn: "triceps, front delts, serratus anterior",
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
    primaryMusclesUk: "передні та середні дельти",
    primaryMusclesEn: "front and middle delts",
    secondaryMusclesUk: "трицепси, трапеції, передній зубчастий м’яз",
    secondaryMusclesEn: "triceps, trapezius, serratus anterior",
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
    secondaryMusclesUk: "надостьові м’язи, трапеції",
    secondaryMusclesEn: "supraspinatus, trapezius",
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
    primaryMusclesUk: "найширші, ромбоподібні, середні трапеції",
    primaryMusclesEn: "lats, rhomboids, middle traps",
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
    primaryMusclesUk: "найширші, середня спина, великі круглі м’язи",
    primaryMusclesEn: "lats, mid-back, teres major",
    secondaryMusclesUk: "біцепси, плечовий м’яз, передпліччя",
    secondaryMusclesEn: "biceps, brachialis, forearms",
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
    secondaryMusclesUk: "плечовий, плечопроменевий м’язи",
    secondaryMusclesEn: "brachialis, brachioradialis",
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
    secondaryMusclesUk: "плечовий, плечопроменевий м’язи",
    secondaryMusclesEn: "brachialis, brachioradialis",
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
    secondaryMusclesUk: "задня поверхня стегна, привідні м’язи стегна, литкові м’язи, м’язи корпуса",
    secondaryMusclesEn: "hamstrings, hip adductors, calves, core",
    cuesUk: ["спирайтеся задньою ногою на лаву", "контролюйте опускання на передній нозі", "тримайте корпус стабільно"],
    cuesEn: ["rest the rear foot on a bench", "control the descent through the front leg", "keep the torso steady"],
  },
  "Випади вперед": {
    primaryMusclesUk: "квадрицепси, сідничні м’язи",
    primaryMusclesEn: "quadriceps, glutes",
    secondaryMusclesUk: "задня поверхня стегна, привідні м’язи стегна, литкові м’язи, м’язи корпуса",
    secondaryMusclesEn: "hamstrings, hip adductors, calves, core",
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
    secondaryMusclesUk: "задня поверхня стегна, привідні м’язи стегна, литкові м’язи",
    secondaryMusclesEn: "hamstrings, hip adductors, calves",
    cuesUk: ["поставте передню стопу на невисоку опору", "опускайтеся під контролем", "зберігайте рівновагу між сторонами"],
    cuesEn: ["place the front foot on a low platform", "lower under control", "keep balance consistent on both sides"],
  },
  "Румунська тяга (Romanian Deadlift)": {
    primaryMusclesUk: "задня поверхня стегна, великий сідничний м’яз",
    primaryMusclesEn: "hamstrings, gluteus maximus",
    secondaryMusclesUk: "розгиначі спини, великий привідний м’яз",
    secondaryMusclesEn: "spinal erectors, adductor magnus",
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
    primaryMusclesUk: "великий сідничний м’яз",
    primaryMusclesEn: "gluteus maximus",
    secondaryMusclesUk: "задня поверхня стегна",
    secondaryMusclesEn: "hamstrings",
    cuesUk: ["розташуйте верх спини на опорі", "піднімайте таз без перерозгинання попереку", "контролюйте опускання штанги"],
    cuesEn: ["set your upper back against the support", "raise the hips without overextending the lower back", "control the bar on the descent"],
  },
  "Відведення ноги назад із нижнім блоком": {
    primaryMusclesUk: "сідничні м’язи",
    primaryMusclesEn: "glutes",
    secondaryMusclesUk: "задня поверхня стегна",
    secondaryMusclesEn: "hamstrings",
    cuesUk: ["закріпіть манжету на щиколотці", "рухайте ногу назад із нерухомим тазом", "не прогинайте поперек"],
    cuesEn: ["secure the cuff at the ankle", "move the leg back while keeping the pelvis steady", "avoid arching the lower back"],
  },
  "Підйоми на носок стоячи на одній нозі": {
    primaryMusclesUk: "литковий і камбалоподібний м’язи",
    primaryMusclesEn: "gastrocnemius and soleus",
    cuesUk: ["за потреби тримайтеся за опору", "піднімайте й опускайте п’яту контрольовано", "виконайте заплановані повторення з обох боків"],
    cuesEn: ["hold a support if needed", "raise and lower the heel under control", "complete the planned repetitions on both sides"],
  },
  "Підйоми на носок сидячи": {
    primaryMusclesUk: "камбалоподібний м’яз",
    primaryMusclesEn: "soleus",
    secondaryMusclesUk: "литковий м’яз",
    secondaryMusclesEn: "gastrocnemius",
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
    primaryMusclesUk: "середній і малий сідничні м’язи",
    primaryMusclesEn: "gluteus medius and minimus",
    secondaryMusclesUk: "напружувач широкої фасції стегна",
    secondaryMusclesEn: "tensor fasciae latae",
    cuesUk: ["закріпіть манжету на щиколотці", "ведіть ногу вбік без повороту таза", "контролюйте повернення до опори"],
    cuesEn: ["secure the cuff at the ankle", "move the leg outward without rotating the pelvis", "control the return"],
  },
};

const copy = (
  primaryMusclesUk: string,
  primaryMusclesEn: string,
  cuesUk: string[],
  cuesEn: string[],
  secondaryMusclesUk?: string,
  secondaryMusclesEn?: string,
): ExerciseInfoCopy => ({
  primaryMusclesUk,
  primaryMusclesEn,
  ...(secondaryMusclesUk && secondaryMusclesEn ? { secondaryMusclesUk, secondaryMusclesEn } : {}),
  cuesUk,
  cuesEn,
});

const ADDITIONAL_EXERCISE_INFO_BY_CATALOG_NAME: Record<string, ExerciseInfoCopy> = {
  "Жим гантелей лежачи на горизонтальній лаві (0°)": copy("груди", "chest", ["зафіксуйте лопатки на лаві", "опускайте гантелі контрольовано", "не зводьте гантелі ударом"], ["set your shoulder blades on the bench", "lower the dumbbells under control", "avoid clashing the dumbbells at the top"], "передні дельти, трицепси", "front delts, triceps"),
  "Махи гантелями перед собою (обидві руки)": copy("передні дельти", "front delts", ["піднімайте гантелі перед собою до рівня плечей", "зберігайте легкий згин у ліктях", "не розгойдуйте корпус"], ["raise both dumbbells in front to shoulder height", "keep a soft bend in the elbows", "avoid swinging your torso"], "верх грудей", "upper chest"),
  "Махи гантелями перед собою (почергово)": copy("передні дельти", "front delts", ["піднімайте по одній гантелі до рівня плеча", "повертайте руку під контролем", "не нахиляйте корпус"], ["raise one dumbbell at a time to shoulder height", "lower each arm under control", "keep your torso upright"], "верх грудей", "upper chest"),
  "Махи гантелями в боки (обидві руки)": copy("середні дельти", "middle delts", ["ведіть лікті вбік", "піднімайте до комфортного рівня плечей", "не підкидайте гантелі інерцією"], ["lead out with your elbows", "raise to a comfortable shoulder-height range", "avoid using momentum"], "надостьові м’язи, трапеції", "supraspinatus, trapezius"),
  "Тяга прямого грифа до підборіддя стоячи (Barbell Upright Row)": copy("середні дельти, верхні трапеції", "middle delts, upper traps", ["тягніть гриф близько до корпуса", "не піднімайте лікті вище комфортного рівня", "зупиніться при дискомфорті в плечі"], ["keep the bar close to your body", "stop before your elbows pass a comfortable height", "stop if you feel shoulder discomfort"], "біцепси, плечові та плечопроменеві м’язи", "biceps, brachialis, brachioradialis"),
  "Молоткові згинання стоячи (обидві руки)": copy("плечовий, плечопроменевий м’язи, біцепси", "brachialis, brachioradialis, biceps", ["утримуйте нейтральний хват", "не рухайте ліктями вперед", "опускайте гантелі без розгойдування"], ["keep a neutral grip", "avoid drifting your elbows forward", "lower without swinging"]),
  "Молоткові згинання стоячи (почергово)": copy("плечовий, плечопроменевий м’язи, біцепси", "brachialis, brachioradialis, biceps", ["зберігайте нейтральний хват", "згинайте руки по черзі", "не розгойдуйте корпус"], ["keep a neutral grip", "curl one arm at a time", "avoid swinging your torso"]),
  "Згинання гантелей із супінацією (обидві руки)": copy("біцепси", "biceps", ["повертайте долоні догори під час згинання", "тримайте лікті біля корпуса", "контролюйте опускання"], ["turn your palms up as you curl", "keep your elbows near your torso", "control the lowering phase"], "плечовий і плечопроменевий м’язи", "brachialis and brachioradialis"),
  "Згинання гантелей із супінацією (почергово)": copy("біцепси", "biceps", ["по черзі повертайте долоню догори", "тримайте плече нерухомим", "не використовуйте інерцію"], ["supinate one hand at a time", "keep the upper arm steady", "avoid using momentum"], "плечовий і плечопроменевий м’язи", "brachialis and brachioradialis"),
  "Віджимання з колін від підлоги": copy("груди", "chest", ["спирайтеся на долоні та коліна", "тримайте корпус рівною лінією від голови до колін", "опускайте груди контрольовано"], ["support yourself on your hands and knees", "keep a straight line from head to knees", "lower your chest under control"], "трицепси, передні дельти, передній зубчастий м’яз", "triceps, front delts, serratus anterior"),
  "Віджимання з колін, руки на лаві": copy("груди", "chest", ["поставте долоні на стійку лаву, коліна залиште на підлозі", "тримайте корпус від голови до колін рівно", "опускайте груди до краю лави"], ["place your hands on a stable bench and keep your knees on the floor", "keep a straight line from head to knees", "lower your chest toward the bench edge"], "трицепси, передні дельти, передній зубчастий м’яз", "triceps, front delts, serratus anterior"),
  "Віджимання від лави з прямими ногами": copy("груди", "chest", ["поставте долоні на стійку лаву, ноги тримайте прямими", "зберігайте одну лінію від голови до п’ят", "опускайте груди контрольовано"], ["place your hands on a stable bench and keep your legs straight", "maintain one line from head to heels", "lower your chest under control"], "трицепси, передні дельти, передній зубчастий м’яз", "triceps, front delts, serratus anterior"),
  "Тяга гантелі однією рукою з упором на лаву": copy("найширші, ромбоподібні, середні трапеції", "lats, rhomboids, middle traps", ["спирайтеся рукою й коліном на лаву", "тягніть лікоть до таза", "не розвертайте корпус"], ["support yourself with one hand and knee on the bench", "pull your elbow toward your hip", "avoid rotating your torso"], "біцепс, задні дельти", "biceps, rear delts"),
  "Французький жим однією рукою лежачи на горизонтальній лаві (0°)": copy("трицепс", "triceps", ["лежачи на горизонтальній лаві, тримайте плече стабільно", "згинайте й розгинайте лікоть однієї руки", "не відводьте лікоть убік"], ["lie on a flat bench and keep the upper arm steady", "bend and extend one elbow", "avoid flaring the elbow outward"]),
  "Французький жим однією гантеллю двома руками лежачи на горизонтальній лаві (0°)": copy("трицепс", "triceps", ["лежачи утримуйте одну гантель двома руками", "згинайте лікті, опускаючи гантель контрольовано", "розгинайте руки без розведення ліктів"], ["lie down and hold one dumbbell with both hands", "bend your elbows to lower the dumbbell under control", "extend without flaring your elbows"]),
  "Французький жим однією рукою з-за голови на похилій лаві (30°)": copy("трицепс", "triceps", ["спинка лави встановлена на 30°", "тримайте плече над головою та згинайте лікоть", "виконуйте рух однією рукою без повороту корпуса"], ["set the bench backrest to 30°", "keep the upper arm overhead and bend at the elbow", "work one arm without rotating your torso"]),
  "Французький жим однією гантеллю двома руками з-за голови на похилій лаві (30°)": copy("трицепс", "triceps", ["спинка лави встановлена на 30°", "утримуйте одну гантель двома руками за головою", "розгинайте лікті без прогину в попереку"], ["set the bench backrest to 30°", "hold one dumbbell with both hands behind your head", "extend your elbows without arching your lower back"]),
  "Французький жим однією рукою з-за голови сидячи, спинка 90°": copy("трицепс", "triceps", ["сядьте зі спинкою 90° і стабілізуйте корпус", "тримайте плече над головою", "розгинайте лікоть однієї руки без розгойдування"], ["sit against a 90° backrest and stabilize your torso", "keep the upper arm overhead", "extend one elbow without swinging"]),
  "Французький жим однією гантеллю двома руками з-за голови сидячи, спинка 90°": copy("трицепс", "triceps", ["сядьте зі спинкою 90° та тримайте одну гантель двома руками", "опускайте її за головою згинанням ліктів", "зберігайте корпус стабільним"], ["sit against a 90° backrest and hold one dumbbell with both hands", "lower it behind your head by bending the elbows", "keep your torso steady"]),
  "Французький жим з EZ-грифом лежачи на горизонтальній лаві (0°)": copy("трицепс", "triceps", ["ляжте на горизонтальну лаву та візьміть EZ-гриф зручним хватом", "згинайте лікті, опускаючи гриф контрольовано", "не перетворюйте рух на жим"], ["lie on a flat bench and take a comfortable EZ-bar grip", "bend your elbows to lower the bar under control", "keep the movement an extension, not a press"]),
  "Французький жим з EZ-грифом лежачи на похилій лаві (30°)": copy("трицепс", "triceps", ["встановіть спинку лави на 30°", "лежачи згинайте й розгинайте лікті з EZ-грифом", "опускайте гриф у контрольовану комфортну точку"], ["set the bench backrest to 30°", "bend and extend your elbows with the EZ bar while lying", "lower the bar to a controlled, comfortable point"]),
  "Французький жим з EZ-грифом з-за голови сидячи, спинка 90°": copy("трицепс", "triceps", ["сядьте зі спинкою 90°", "утримуйте EZ-гриф над головою та згинайте лікті", "не розводьте лікті різко в боки"], ["sit against a 90° backrest", "hold the EZ bar overhead and bend your elbows", "avoid forcing the elbows wide"]),
  "Французький жим з EZ-грифом з-за голови сидячи, спинка 30°": copy("трицепс", "triceps", ["встановіть спинку лави на 30° та сядьте", "опускайте EZ-гриф за голову згинанням ліктів", "тримайте корпус і плечі стабільними"], ["set the backrest to 30° and sit", "lower the EZ bar behind your head by bending your elbows", "keep your torso and upper arms steady"]),
};

export function resolveExerciseInfo(input: {
  catalogName?: string | null;
  snapshotExerciseName?: string | null;
}): ExerciseInfoCopy | null {
  const candidates = [input.catalogName, input.snapshotExerciseName]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  for (const name of candidates) {
    const exact = EXERCISE_INFO_BY_CATALOG_NAME[name] ?? ADDITIONAL_EXERCISE_INFO_BY_CATALOG_NAME[name];
    if (exact) return exact;
  }
  return null;
}
