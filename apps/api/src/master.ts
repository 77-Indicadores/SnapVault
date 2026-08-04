import cluster from "node:cluster";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WORKER_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "server.js");
const HEALTH_TIMEOUT_MS = 30_000; // max wait for new worker to be ready
const SHUTDOWN_GRACE_MS = 5_000;  // max wait for old worker to drain

cluster.setupPrimary({ exec: WORKER_SCRIPT });

let current = forkWorker();
let restarting = false;

function forkWorker(): ReturnType<typeof cluster.fork> {
  const worker = cluster.fork();
  console.log(`[master] worker ${worker.process.pid} iniciado`);

  worker.on("message", (msg: { type: string }) => {
    if (msg.type === "restart") handleRestart();
  });

  return worker;
}

cluster.on("exit", (worker, code, signal) => {
  console.log(`[master] worker ${worker.process.pid} encerrou (code=${code} signal=${signal})`);
  if (!restarting && worker.id === current.id) {
    // Worker caiu inesperadamente — refork imediato
    console.log("[master] worker caiu inesperadamente — reiniciando");
    current = forkWorker();
  }
});

async function handleRestart() {
  if (restarting) {
    console.log("[master] restart ja em andamento, ignorando");
    return;
  }
  restarting = true;
  console.log("[master] iniciando rolling restart...");

  const oldWorker = current;

  // 1. Sobe novo worker
  const newWorker = cluster.fork();
  console.log(`[master] novo worker ${newWorker.process.pid} subindo...`);

  newWorker.on("message", (msg: { type: string }) => {
    if (msg.type === "restart") handleRestart();
  });

  // 2. Aguarda novo worker sinalizar que está pronto (ou timeout)
  const ready = await Promise.race([
    new Promise<boolean>((resolve) => {
      newWorker.on("message", (msg: { type: string }) => {
        if (msg.type === "ready") resolve(true);
      });
      newWorker.on("exit", () => resolve(false));
    }),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), HEALTH_TIMEOUT_MS)),
  ]);

  if (!ready) {
    console.error("[master] novo worker nao ficou pronto a tempo — abortando restart");
    newWorker.kill();
    restarting = false;
    return;
  }

  // 3. Novo worker está pronto — promove e encerra o antigo gracefully
  current = newWorker;
  console.log(`[master] novo worker ${newWorker.process.pid} pronto — encerrando worker antigo ${oldWorker.process.pid}`);

  oldWorker.send({ type: "shutdown" });

  await new Promise<void>((resolve) => {
    const forceKill = setTimeout(() => {
      console.warn(`[master] forcando kill do worker antigo ${oldWorker.process.pid}`);
      if (!oldWorker.isDead()) oldWorker.kill();
      resolve();
    }, SHUTDOWN_GRACE_MS);

    oldWorker.on("exit", () => {
      clearTimeout(forceKill);
      resolve();
    });
  });

  console.log("[master] rolling restart concluido com sucesso");
  restarting = false;
}

process.on("SIGTERM", async () => {
  console.log("[master] SIGTERM recebido — encerrando");
  current.send({ type: "shutdown" });
  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS + 1000);
});

process.on("SIGINT", async () => {
  console.log("[master] SIGINT recebido — encerrando");
  current.send({ type: "shutdown" });
  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS + 1000);
});

console.log(`[master] SnapVault master PID ${process.pid} iniciado`);
