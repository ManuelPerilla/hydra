import type { Locale } from "./messages";

type LessonCopy = { title: string; body: string };

export type LearningMessages = {
  homeTitle: string;
  homeIntro: string;
  learnLabel: string;
  consoleLabel: string;
  consoleHint: string;
  simulationBadge: string;
  simulationNotice: string;
  lessonTitle: string;
  lessonIntro: string;
  steps: [string, string, string, string];
  concepts: [LessonCopy, LessonCopy, LessonCopy];
  predictionQuestion: string;
  predictions: [string, string, string];
  predictionHint: string;
  continueLabel: string;
  backLabel: string;
  resetLabel: string;
  removeLabel: string;
  advanceLabel: string;
  desiredLabel: string;
  readyLabel: string;
  podLabel: string;
  statuses: { ready: string; missing: string; starting: string };
  stages: [LessonCopy, LessonCopy, LessonCopy, LessonCopy];
  debriefTitle: string;
  correctFeedback: string;
  incorrectFeedback: string;
  debriefBody: string;
  caveat: string;
  retryLabel: string;
  nextTitle: string;
  nextBody: string;
  languageLabel: string;
};

const es: LearningMessages = {
  homeTitle: "Aprende Kubernetes, un experimento a la vez.",
  homeIntro: "Empieza desde cero: entiende una idea, haz una predicción y observa qué ocurre cuando desaparece un pod.",
  learnLabel: "Empezar la lección",
  consoleLabel: "Abrir consola avanzada",
  consoleHint: "Para experimentar en un clúster real conectado.",
  simulationBadge: "Simulación educativa",
  simulationNotice: "Esta lección funciona solo en tu navegador. No necesita cuenta, clúster ni API y no modifica pods reales.",
  lessonTitle: "¿Qué pasa si desaparece un pod?",
  lessonIntro: "Tenemos dos copias de una aplicación. Quitaremos una y seguiremos, paso a paso, cómo Kubernetes intenta recuperar el número deseado.",
  steps: ["Entender", "Predecir", "Experimentar", "Repasar"],
  concepts: [
    { title: "Pod: una unidad de ejecución", body: "Un pod agrupa uno o más contenedores que se ejecutan juntos. Aquí, cada pod representa una copia de nuestra aplicación." },
    { title: "Deployment y ReplicaSet: mantener el objetivo", body: "El Deployment declara dos réplicas y administra un ReplicaSet. Este compara los pods existentes con el número deseado y crea reemplazos cuando faltan." },
    { title: "Readiness: estar listo para recibir tráfico", body: "Existir no basta. Un pod debe cumplir sus condiciones de preparación, incluidas las comprobaciones configuradas, para estar listo. Arrancar y estar listo son estados distintos." },
  ],
  predictionQuestion: "Si desaparece el pod A y seguimos deseando dos réplicas, ¿qué intentará hacer el ReplicaSet?",
  predictions: ["Mantener una sola réplica.", "Crear un reemplazo para volver a tener dos réplicas.", "Duplicar el objetivo hasta cuatro réplicas."],
  predictionHint: "Elige una respuesta antes de experimentar. Piensa en el número deseado.",
  continueLabel: "Continuar",
  backLabel: "Volver",
  resetLabel: "Reiniciar simulación",
  removeLabel: "Quitar el pod A simulado",
  advanceLabel: "Ver el siguiente paso",
  desiredLabel: "Réplicas deseadas",
  readyLabel: "Pods listos",
  podLabel: "Pod",
  statuses: { ready: "Listo", missing: "Eliminado", starting: "Arrancando" },
  stages: [
    { title: "Dos pods listos", body: "A y B están listos. El objetivo es de dos réplicas y hay dos pods listos." },
    { title: "Falta el pod A", body: "Quitamos A en la simulación. B sigue listo. El objetivo sigue siendo dos, pero ahora solo hay un pod listo." },
    { title: "Se crea el reemplazo C", body: "El ReplicaSet crea C para reemplazar el pod que falta. C está arrancando; todavía solo B está listo." },
    { title: "Volvemos a tener dos pods listos", body: "En este ejemplo, C pasa sus comprobaciones de preparación. B y C están listos. El objetivo nunca dejó de ser dos." },
  ],
  debriefTitle: "¿Qué acabamos de observar?",
  correctFeedback: "Tu predicción coincide con el objetivo: crear un reemplazo para recuperar las dos réplicas.",
  incorrectFeedback: "La clave es el número deseado: sigue siendo dos. El ReplicaSet intenta crear un reemplazo para la réplica que falta.",
  debriefBody: "C es un pod nuevo, con una identidad nueva. A no resucita. El ReplicaSet intenta acercar el estado real al deseado; después, el reemplazo debe estar listo para recibir tráfico.",
  caveat: "Es una secuencia simplificada. La falta de recursos, los problemas de asignación a nodos, la descarga de imágenes o las comprobaciones de salud pueden impedir la recuperación. Esta lección no garantiza tiempos de recuperación ni disponibilidad reales.",
  retryLabel: "Repetir la lección",
  nextTitle: "Cuando quieras probar con infraestructura real",
  nextBody: "La consola avanzada necesita un clúster de Kubernetes, Hydra API, el agente conectado y los permisos adecuados. Allí los experimentos actúan sobre pods reales del laboratorio.",
  languageLabel: "Idioma",
};

const en: LearningMessages = {
  homeTitle: "Learn Kubernetes, one experiment at a time.",
  homeIntro: "Start from the basics: understand an idea, make a prediction, and see what happens when a pod disappears.",
  learnLabel: "Start the lesson",
  consoleLabel: "Open advanced console",
  consoleHint: "For experiments on a connected, real cluster.",
  simulationBadge: "Learning simulation",
  simulationNotice: "This lesson runs only in your browser. No account, cluster, or API is needed, and no real pods are changed.",
  lessonTitle: "What happens when a pod disappears?",
  lessonIntro: "We have two copies of an application. Remove one and follow, step by step, how Kubernetes tries to restore the desired count.",
  steps: ["Understand", "Predict", "Experiment", "Debrief"],
  concepts: [
    { title: "Pod: a unit of execution", body: "A pod groups one or more containers that run together. Here, each pod represents one copy of our application." },
    { title: "Deployment and ReplicaSet: keep the target", body: "The Deployment declares two replicas and manages a ReplicaSet. The ReplicaSet compares existing pods with the desired count and creates replacements when pods are missing." },
    { title: "Readiness: ready to receive traffic", body: "Existing is not enough. A pod must meet its readiness conditions, including any configured checks, to be ready. Starting up and being ready are different states." },
  ],
  predictionQuestion: "If pod A disappears and we still want two replicas, what will the ReplicaSet try to do?",
  predictions: ["Keep just one replica.", "Create a replacement to restore two replicas.", "Double the target to four replicas."],
  predictionHint: "Choose an answer before experimenting. Think about the desired count.",
  continueLabel: "Continue",
  backLabel: "Back",
  resetLabel: "Reset simulation",
  removeLabel: "Remove simulated pod A",
  advanceLabel: "See the next step",
  desiredLabel: "Desired replicas",
  readyLabel: "Ready pods",
  podLabel: "Pod",
  statuses: { ready: "Ready", missing: "Removed", starting: "Starting" },
  stages: [
    { title: "Two ready pods", body: "A and B are ready. The target is two replicas, and two pods are ready." },
    { title: "Pod A is missing", body: "We remove A in the simulation. B stays ready. The target is still two, but only one pod is ready now." },
    { title: "Replacement C is created", body: "The ReplicaSet creates C to replace the missing pod. C is starting; only B is ready so far." },
    { title: "Back to two ready pods", body: "In this example, C passes its readiness checks. B and C are ready. The target stayed at two throughout." },
  ],
  debriefTitle: "What did we observe?",
  correctFeedback: "Your prediction matches the target: create a replacement to restore two replicas.",
  incorrectFeedback: "The key is the desired count: it is still two. The ReplicaSet tries to create a replacement for the missing replica.",
  debriefBody: "C is a new pod with a new identity. A does not come back to life. The ReplicaSet tries to bring actual state toward desired state; the replacement then needs to become ready to receive traffic.",
  caveat: "This is a simplified sequence. Resource shortages, scheduling problems, image pull failures, or failed health checks can prevent recovery. This lesson guarantees neither real recovery times nor availability.",
  retryLabel: "Try the lesson again",
  nextTitle: "When you want to try real infrastructure",
  nextBody: "The advanced console needs a Kubernetes cluster, Hydra API, a connected agent, and the right permissions. Experiments there act on real lab pods.",
  languageLabel: "Language",
};

const pt: LearningMessages = {
  homeTitle: "Aprenda Kubernetes, um experimento por vez.",
  homeIntro: "Comece do básico: entenda uma ideia, faça uma previsão e veja o que acontece quando um pod desaparece.",
  learnLabel: "Começar a lição",
  consoleLabel: "Abrir console avançado",
  consoleHint: "Para experimentar em um cluster real conectado.",
  simulationBadge: "Simulação educativa",
  simulationNotice: "Esta lição funciona apenas no navegador. Não exige conta, cluster ou API e não altera pods reais.",
  lessonTitle: "O que acontece quando um pod desaparece?",
  lessonIntro: "Temos duas cópias de uma aplicação. Vamos remover uma e acompanhar, passo a passo, como o Kubernetes tenta restaurar a quantidade desejada.",
  steps: ["Entender", "Prever", "Experimentar", "Revisar"],
  concepts: [
    { title: "Pod: uma unidade de execução", body: "Um pod agrupa um ou mais contêineres que executam juntos. Aqui, cada pod representa uma cópia da nossa aplicação." },
    { title: "Deployment e ReplicaSet: manter a meta", body: "O Deployment declara duas réplicas e gerencia um ReplicaSet. O ReplicaSet compara os pods existentes com a quantidade desejada e cria substitutos quando faltam pods." },
    { title: "Readiness: pronto para receber tráfego", body: "Existir não basta. Um pod precisa atender às condições de prontidão, incluindo as verificações configuradas, para estar pronto. Iniciar e estar pronto são estados diferentes." },
  ],
  predictionQuestion: "Se o pod A desaparecer e ainda quisermos duas réplicas, o que o ReplicaSet tentará fazer?",
  predictions: ["Manter apenas uma réplica.", "Criar um substituto para voltar a ter duas réplicas.", "Dobrar a meta para quatro réplicas."],
  predictionHint: "Escolha uma resposta antes de experimentar. Pense na quantidade desejada.",
  continueLabel: "Continuar",
  backLabel: "Voltar",
  resetLabel: "Reiniciar simulação",
  removeLabel: "Remover o pod A simulado",
  advanceLabel: "Ver o próximo passo",
  desiredLabel: "Réplicas desejadas",
  readyLabel: "Pods prontos",
  podLabel: "Pod",
  statuses: { ready: "Pronto", missing: "Removido", starting: "Iniciando" },
  stages: [
    { title: "Dois pods prontos", body: "A e B estão prontos. A meta é de duas réplicas e há dois pods prontos." },
    { title: "O pod A está ausente", body: "Removemos A na simulação. B continua pronto. A meta ainda é dois, mas agora apenas um pod está pronto." },
    { title: "O substituto C é criado", body: "O ReplicaSet cria C para substituir o pod ausente. C está iniciando; por enquanto, só B está pronto." },
    { title: "Dois pods prontos novamente", body: "Neste exemplo, C passa nas verificações de prontidão. B e C estão prontos. A meta permaneceu em dois o tempo todo." },
  ],
  debriefTitle: "O que acabamos de observar?",
  correctFeedback: "Sua previsão corresponde à meta: criar um substituto para restaurar as duas réplicas.",
  incorrectFeedback: "O importante é a quantidade desejada: continua sendo dois. O ReplicaSet tenta criar um substituto para a réplica ausente.",
  debriefBody: "C é um pod novo, com uma nova identidade. A não volta à vida. O ReplicaSet tenta aproximar o estado real do desejado; depois, o substituto precisa ficar pronto para receber tráfego.",
  caveat: "Esta sequência é simplificada. Falta de recursos, problemas de agendamento em nós, falhas ao baixar imagens ou nas verificações de saúde podem impedir a recuperação. Esta lição não garante tempos de recuperação nem disponibilidade reais.",
  retryLabel: "Repetir a lição",
  nextTitle: "Quando quiser testar com infraestrutura real",
  nextBody: "O console avançado exige um cluster Kubernetes, a Hydra API, o agente conectado e as permissões adequadas. Os experimentos nele afetam pods reais do laboratório.",
  languageLabel: "Idioma",
};

const ar: LearningMessages = {
  homeTitle: "تعلّم Kubernetes، تجربةً تلو الأخرى.",
  homeIntro: "ابدأ من الأساسيات: افهم الفكرة، وتوقّع النتيجة، ثم شاهد ما يحدث عندما تختفي وحدة Pod.",
  learnLabel: "ابدأ الدرس",
  consoleLabel: "افتح لوحة التحكم المتقدمة",
  consoleHint: "لإجراء تجارب على مجموعة Kubernetes حقيقية ومتصلة.",
  simulationBadge: "محاكاة تعليمية",
  simulationNotice: "يعمل هذا الدرس في متصفحك فقط. لا يحتاج إلى حساب أو مجموعة Kubernetes أو واجهة API، ولا يغيّر أي وحدات فعلية.",
  lessonTitle: "ماذا يحدث عندما تختفي وحدة Pod؟",
  lessonIntro: "لدينا نسختان من تطبيق. سنزيل إحداهما ونتابع، خطوةً بخطوة، كيف يحاول Kubernetes استعادة العدد المطلوب.",
  steps: ["افهم", "توقّع", "جرّب", "راجع"],
  concepts: [
    { title: "Pod: وحدة تشغيل", body: "تجمع وحدة Pod حاوية واحدة أو أكثر تعمل معًا. في هذا الدرس، تمثل كل وحدة نسخة واحدة من تطبيقنا." },
    { title: "Deployment وReplicaSet: الحفاظ على العدد المطلوب", body: "يحدد Deployment نسختين ويدير ReplicaSet. يقارن ReplicaSet عدد الوحدات الموجودة بالعدد المطلوب، وينشئ بدائل عندما تنقص الوحدات." },
    { title: "الجاهزية: الاستعداد لاستقبال الطلبات", body: "وجود الوحدة وحده لا يكفي. يجب أن تستوفي شروط الجاهزية، بما فيها الفحوص المضبوطة، حتى تصبح جاهزة. بدء التشغيل والجاهزية حالتان مختلفتان." },
  ],
  predictionQuestion: "إذا اختفت الوحدة A وظل العدد المطلوب نسختين، فماذا سيحاول ReplicaSet أن يفعل؟",
  predictions: ["الإبقاء على نسخة واحدة فقط.", "إنشاء بديل لاستعادة العدد إلى نسختين.", "مضاعفة العدد المطلوب إلى أربع نسخ."],
  predictionHint: "اختر إجابة قبل التجربة. فكّر في العدد المطلوب.",
  continueLabel: "متابعة",
  backLabel: "رجوع",
  resetLabel: "إعادة المحاكاة",
  removeLabel: "إزالة الوحدة A في المحاكاة",
  advanceLabel: "عرض الخطوة التالية",
  desiredLabel: "النسخ المطلوبة",
  readyLabel: "الوحدات الجاهزة",
  podLabel: "الوحدة",
  statuses: { ready: "جاهزة", missing: "محذوفة", starting: "قيد البدء" },
  stages: [
    { title: "وحدتان جاهزتان", body: "الوحدتان A وB جاهزتان. العدد المطلوب نسختان، ولدينا وحدتان جاهزتان." },
    { title: "الوحدة A لم تعد موجودة", body: "نزيل A في المحاكاة. تبقى B جاهزة. لا يزال العدد المطلوب نسختين، لكن لدينا الآن وحدة جاهزة واحدة فقط." },
    { title: "إنشاء الوحدة البديلة C", body: "ينشئ ReplicaSet الوحدة C لتحل محل الوحدة المفقودة. لا تزال C قيد البدء؛ وحدها B جاهزة حتى الآن." },
    { title: "وحدتان جاهزتان من جديد", body: "في هذا المثال، تجتاز C فحوص الجاهزية. تصبح B وC جاهزتين. ظل العدد المطلوب نسختين طوال التجربة." },
  ],
  debriefTitle: "ماذا لاحظنا؟",
  correctFeedback: "يتوافق توقّعك مع الهدف: إنشاء بديل لاستعادة العدد إلى نسختين.",
  incorrectFeedback: "المهم هو العدد المطلوب: لا يزال نسختين. يحاول ReplicaSet إنشاء بديل للنسخة المفقودة.",
  debriefBody: "الوحدة C جديدة ولها هوية جديدة. لا تعود A إلى الحياة. يحاول ReplicaSet تقريب الحالة الفعلية من الحالة المطلوبة؛ وبعد ذلك يجب أن تصبح الوحدة البديلة جاهزة لاستقبال الطلبات.",
  caveat: "هذا تسلسل مبسّط. قد يمنع نقص الموارد أو مشكلات إسناد الوحدات إلى العُقد أو تنزيل صور الحاويات أو فشل فحوص الصحة حدوث التعافي. لا يضمن هذا الدرس زمنًا فعليًا للتعافي أو استمرار إتاحة الخدمة.",
  retryLabel: "جرّب الدرس مجددًا",
  nextTitle: "عندما تريد التجربة على بنية فعلية",
  nextBody: "تحتاج لوحة التحكم المتقدمة إلى مجموعة Kubernetes وواجهة Hydra API ووكيل متصل والصلاحيات المناسبة. تؤثر التجارب فيها على وحدات فعلية داخل المختبر.",
  languageLabel: "اللغة",
};

export const learningMessages: Record<Locale, LearningMessages> = { es, en, pt, ar };
