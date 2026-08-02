import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  Check,
  ChevronLeft,
  Cloud,
  Database,
  FileArchive,
  FolderClock,
  HardDrive,
  KeyRound,
  Loader2,
  LogOut,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";
import "./styles.css";

const api = async (path: string, options: RequestInit = {}) => {
  const res = await fetch(`/api/v1${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    credentials: "include"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message ?? "Request failed");
  return data;
};

type View = "overview" | "backups" | "storage" | "settings";
type SourceType = "postgres" | "minio";
type DestinationType = "sharepoint" | "onedrive";
type Frequency = "manual" | "daily" | "weekly";
type Source = { id: string; name: string; type: SourceType | string; status: string };
type Destination = { id: string; name: string; type: DestinationType | string; status: string; basePath: string };
type BackupRoutine = { id: string; name: string; sourceId: string; destinationId: string; enabled: boolean; schedule?: { type: string; time?: string; timezone?: string }; retention?: { keepLast: number; keepDays: number } };
type Run = { id: string; policyId: string; sourceId?: string; destinationId?: string; status: string; verificationStatus?: string; verifiedAt?: string | null; createdAt: string; bytesWritten: number | null; errorMessage: string | null };
type Artifact = { id: string; kind: string; path: string; sizeBytes: number | null; checksumSha256: string | null };
type RunDetail = { run: Run; logs: Array<{ message: string; level: string; createdAt: string }>; artifacts: Artifact[] };
type AppData = { sources: Source[]; destinations: Destination[]; policies: BackupRoutine[]; runs: Run[] };
type Notice = { tone: "success" | "error"; text: string } | null;

const emptyData: AppData = { sources: [], destinations: [], policies: [], runs: [] };

function App() {
  const [setup, setSetup] = useState<boolean | null>(null);
  const [user, setUser] = useState<any>(null);
  const [data, setData] = useState<AppData>(emptyData);
  const [view, setView] = useState<View>("overview");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = async () => {
    const [sources, destinations, policies, runs] = await Promise.all([api("/sources"), api("/destinations"), api("/policies"), api("/runs")]);
    setData({ sources: sources.sources, destinations: destinations.destinations, policies: policies.policies, runs: runs.runs });
  };

  const showNotice = (next: Notice) => {
    setNotice(next);
    window.setTimeout(() => setNotice(null), 3500);
  };

  useEffect(() => {
    fetch("/api/v1/setup/status").then((r) => r.json()).then(async (status) => {
      setSetup(status.requiresSetup);
      if (!status.requiresSetup) {
        try {
          const me = await api("/auth/me");
          setUser(me.user);
          await refresh();
        } catch {
          setUser(null);
        }
      }
      setLoading(false);
    });
  }, []);

  const runNow = async (policyId: string) => {
    setBusy(policyId);
    try {
      const result = await api(`/policies/${policyId}/run`, { method: "POST", body: "{}" });
      showNotice({ tone: "success", text: "Backup iniciado." });
      setSelectedRunId(result.runId);
      setTimeout(refresh, 900);
    } catch (err: any) {
      showNotice({ tone: "error", text: err.message });
    } finally {
      setBusy("");
    }
  };

  const togglePolicy = async (policy: BackupRoutine) => {
    setBusy(policy.id);
    try {
      await api(`/policies/${policy.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !policy.enabled }) });
      await refresh();
      showNotice({ tone: "success", text: policy.enabled ? "Backup pausado." : "Backup reativado." });
    } catch (err: any) {
      showNotice({ tone: "error", text: err.message });
    } finally {
      setBusy("");
    }
  };

  const deletePolicy = async (id: string) => {
    setBusy(id);
    try {
      await api(`/policies/${id}`, { method: "DELETE" });
      await refresh();
      showNotice({ tone: "success", text: "Backup removido." });
    } catch (err: any) {
      showNotice({ tone: "error", text: err.message });
    } finally {
      setBusy("");
    }
  };

  const logout = async () => {
    await api("/auth/logout", { method: "POST", body: "{}" });
    setUser(null);
  };

  if (loading || setup === null) return <AppShell><LoadingState /></AppShell>;
  if (setup) return <AuthMode mode="setup" error={error} setError={setError} onDone={(created) => { setUser(created); setSetup(false); }} />;
  if (!user) return <AuthMode mode="login" error={error} setError={setError} onDone={(logged) => { setUser(logged); refresh(); }} />;

  return (
    <AppShell user={user} view={view} setView={setView} onNewBackup={() => setWizardOpen(true)}>
      {notice && <div className={`toast ${notice.tone}`}>{notice.text}</div>}
      {view === "overview" && <OverviewPage data={data} onNewBackup={() => setWizardOpen(true)} onRun={runNow} onRunOpen={setSelectedRunId} onPolicyOpen={(id) => { setSelectedPolicyId(id); setView("backups"); }} busy={busy} />}
      {view === "backups" && (selectedPolicyId ? <BackupDetailPage data={data} policyId={selectedPolicyId} onBack={() => setSelectedPolicyId("")} onRun={runNow} onRunOpen={setSelectedRunId} onToggle={togglePolicy} refresh={refresh} showNotice={showNotice} busy={busy} /> : <BackupsPage data={data} onNewBackup={() => setWizardOpen(true)} onRun={runNow} onRunOpen={setSelectedRunId} onPolicyOpen={setSelectedPolicyId} onToggle={togglePolicy} onDelete={deletePolicy} busy={busy} />)}
      {view === "storage" && <StoragePage data={data} refresh={refresh} openCreate={() => setStorageOpen(true)} showNotice={showNotice} />}
      {view === "settings" && <SettingsPage user={user} onLogout={logout} />}
      {wizardOpen && <NewBackupWizard data={data} onClose={() => setWizardOpen(false)} onDone={async (runId) => { setWizardOpen(false); await refresh(); if (runId) setSelectedRunId(runId); setView("overview"); showNotice({ tone: "success", text: "Rotina criada e primeira execucao iniciada." }); }} />}
      {storageOpen && <ConnectStorageModal onClose={() => setStorageOpen(false)} onDone={async () => { setStorageOpen(false); await refresh(); showNotice({ tone: "success", text: "Armazenamento conectado." }); }} />}
      {selectedRunId && <RunDetailModal runId={selectedRunId} onClose={() => setSelectedRunId("")} />}
    </AppShell>
  );
}

function AppShell({ children, user, view, setView, onNewBackup }: { children: React.ReactNode; user?: any; view?: View; setView?: (view: View) => void; onNewBackup?: () => void }) {
  const nav: Array<[View, string]> = [["overview", "Overview"], ["backups", "Backups"], ["storage", "Storage"], ["settings", "Settings"]];
  return (
    <main className="shell">
      <header className="topNav">
        <button className="brandButton" onClick={() => setView?.("overview")} aria-label="Ir para overview">
          <Archive size={18} />
          <strong>SnapVault</strong>
        </button>
        {user && (
          <>
            <nav className="tabs" aria-label="Navegacao principal">
              {nav.map(([key, label]) => <button key={key} className={view === key ? "active" : ""} onClick={() => setView?.(key)}>{label}</button>)}
            </nav>
            <div className="topActions">
              <span className="account">{user.email}</span>
              <button className="primaryButton" onClick={onNewBackup}><Plus size={15} /> Novo backup</button>
            </div>
          </>
        )}
      </header>
      <section className="page">{children}</section>
    </main>
  );
}

function OverviewPage({ data, onNewBackup, onRun, onRunOpen, onPolicyOpen, busy }: { data: AppData; onNewBackup: () => void; onRun: (id: string) => void; onRunOpen: (id: string) => void; onPolicyOpen: (id: string) => void; busy: string }) {
  const latest = data.runs[0];
  const verified = latest?.status === "verified" || latest?.status === "recoverable" || latest?.verificationStatus === "integrity_verified";
  const recoverable = latest?.status === "recoverable" || latest?.verificationStatus === "restore_verified";
  const ready = data.sources.length > 0 && data.destinations.length > 0 && data.policies.length > 0 && verified;
  return (
    <>
      <PageTitle eyebrow="Overview" title="Backups sem barulho." text="Configure uma vez, rode automaticamente e veja rapidamente se seus dados estao protegidos." />
      <section className="heroCard">
        <div className={`statusDot ${ready ? "ok" : "warn"}`}><ShieldCheck size={18} /></div>
        <div>
          <h2>{recoverable ? "Restore testado recentemente" : ready ? "Ultimo backup verificado" : "Finalize a primeira protecao"}</h2>
          <p>{recoverable ? "Existe um backup recente que passou por verificacao de restore." : ready ? "O arquivo foi gerado, checado por integridade e enviado ao destino. Restore automatico ainda fica separado." : "Siga os passos abaixo para criar o primeiro backup automatico."}</p>
        </div>
      </section>
      <section className="overviewGrid">
        <SetupChecklist data={data} onNewBackup={onNewBackup} />
        <RecentRuns runs={data.runs} onOpen={onRunOpen} />
      </section>
      <section className="sectionBlock">
        <SectionHeader title="Backups configurados" action={<button className="secondaryButton" onClick={onNewBackup}><Plus size={15} /> Adicionar</button>} />
        <BackupList data={data} onRun={onRun} onRunOpen={onRunOpen} onPolicyOpen={onPolicyOpen} busy={busy} limit={4} />
      </section>
    </>
  );
}

function BackupsPage(props: { data: AppData; onNewBackup: () => void; onRun: (id: string) => void; onRunOpen: (id: string) => void; onPolicyOpen: (id: string) => void; onToggle: (policy: BackupRoutine) => void; onDelete: (id: string) => void; busy: string }) {
  return (
    <>
      <PageTitle eyebrow="Backups" title="Rotinas de backup" text="Cada rotina define o que proteger, onde salvar e quando executar." />
      <section className="sectionBlock">
        <BackupList {...props} />
      </section>
    </>
  );
}

function BackupDetailPage({ data, policyId, onBack, onRun, onRunOpen, onToggle, refresh, showNotice, busy }: { data: AppData; policyId: string; onBack: () => void; onRun: (id: string) => void; onRunOpen: (id: string) => void; onToggle: (policy: BackupRoutine) => void; refresh: () => Promise<void>; showNotice: (notice: Notice) => void; busy: string }) {
  const [restoreBusy, setRestoreBusy] = useState("");
  const [testBusy, setTestBusy] = useState("");
  const policy = data.policies.find((item) => item.id === policyId);
  if (!policy) return <EmptyState title="Backup nao encontrado" text="A rotina pode ter sido removida." />;
  const source = data.sources.find((item) => item.id === policy.sourceId);
  const destination = data.destinations.find((item) => item.id === policy.destinationId);
  const runs = data.runs.filter((run) => run.policyId === policy.id);
  const latest = runs[0];
  const verified = latest?.status === "verified" || latest?.status === "recoverable" || latest?.verificationStatus === "integrity_verified";
  const recoverable = latest?.status === "recoverable" || latest?.verificationStatus === "restore_verified";
  const restoreFailed = latest?.status === "restore_failed";

  const prepareRestore = async (runId: string) => {
    setRestoreBusy(runId);
    try {
      const detail: RunDetail = await api(`/runs/${runId}`);
      if (!detail.artifacts.length) throw new Error("Esta execucao nao possui artefatos.");
      const artifact = detail.artifacts.find((item) => item.kind !== "manifest") ?? detail.artifacts[0];
      const result = await api("/restores/prepare", { method: "POST", body: JSON.stringify({ artifactId: artifact.id }) });
      showNotice({ tone: "success", text: `Recuperacao preparada para ${result.restore.sourceType}.` });
      onRunOpen(runId);
    } catch (err: any) {
      showNotice({ tone: "error", text: err.message });
    } finally {
      setRestoreBusy("");
    }
  };

  const testRestore = async (runId: string) => {
    setTestBusy(runId);
    try {
      const result = await api(`/runs/${runId}/test-restore`, { method: "POST", body: "{}" });
      await refresh();
      showNotice({ tone: result.status === "recoverable" ? "success" : "error", text: result.message });
      onRunOpen(runId);
    } catch (err: any) {
      showNotice({ tone: "error", text: err.message });
    } finally {
      setTestBusy("");
    }
  };

  return (
    <>
      <header className="detailTitle">
        <button className="secondaryButton small" onClick={onBack}><ChevronLeft size={15} /> Backups</button>
        <div>
          <span>Backup</span>
          <h1>{policy.name}</h1>
          <p>{source?.type ?? "origem"} para {destination?.type ?? "armazenamento"} · {policy.enabled ? "ativo" : "pausado"}</p>
        </div>
        <div className="detailActions">
          <button className="secondaryButton" disabled={busy === policy.id} onClick={() => onToggle(policy)}><Pause size={15} /> {policy.enabled ? "Pausar" : "Ativar"}</button>
          <button className="primaryButton" disabled={busy === policy.id} onClick={() => onRun(policy.id)}>{busy === policy.id ? <Loader2 className="spin" size={15} /> : <Play size={15} />} Executar agora</button>
        </div>
      </header>

      <section className="trustGrid">
        <TrustCard title="Ultimo backup" value={latest ? statusLabel(latest.status) : "sem execucao"} tone={verified ? "ok" : "warn"} />
        <TrustCard title="Integridade" value={latest ? verificationLabel(latest) : "nao verificado"} tone={verified ? "ok" : "warn"} />
        <TrustCard title="Restore" value={testBusy ? "testando..." : recoverable ? "testado" : restoreFailed ? "falhou" : "ainda nao testado"} tone={recoverable ? "ok" : "warn"} />
        <TrustCard title="Tamanho" value={formatBytes(latest?.bytesWritten ?? null)} />
      </section>

      <section className="detailGrid">
        <section className="sectionBlock">
          <SectionHeader title="Historico desta rotina" />
          {!runs.length ? <EmptyState compact title="Sem execucoes" text="Execute agora para gerar o primeiro backup." /> : (
            <div className="itemList">
              {runs.map((run) => (
                <article className="listItem" key={run.id}>
                  <button className="itemMain itemButton" onClick={() => onRunOpen(run.id)}>
                    <strong>{formatDate(run.createdAt)}</strong>
                    <span>{run.id} · {verificationLabel(run)} · {formatBytes(run.bytesWritten)}</span>
                  </button>
                  <StatusBadge status={run.status} />
                  <div className="rowActions">
                    <button className="secondaryButton small" onClick={() => onRunOpen(run.id)}><FileArchive size={14} /> Artefatos</button>
                    <button className="secondaryButton small" disabled={testBusy === run.id} onClick={() => testRestore(run.id)}>{testBusy === run.id ? <Loader2 className="spin" size={14} /> : <ShieldCheck size={14} />} Testar restore</button>
                    <button className="primaryButton small" disabled={restoreBusy === run.id} onClick={() => prepareRestore(run.id)}>{restoreBusy === run.id ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />} Recuperar</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <aside className="detailSide">
          <InfoCard title="Configuracao" rows={[["Origem", source?.name ?? "nao encontrada"], ["Tipo", String(source?.type ?? "-")], ["Destino", destination?.name ?? "nao encontrado"], ["Pasta", destination?.basePath ?? "-"], ["Frequencia", scheduleLabel(policy)], ["Retencao", retentionLabel(policy)]]} />
          <section className="card">
            <SectionHeader title="Recuperacao" />
            <div className="sideCopy">
              <strong>{recoverable ? "Restore validado" : restoreFailed ? "Restore falhou" : "Restore ainda nao validado"}</strong>
              <span>{recoverable ? "Esta rotina possui evidencia de recuperacao." : restoreFailed ? "O arquivo existe, mas o restore automatico falhou. Abra a execucao para ver os logs." : "O restore automatico roda apos cada backup verificado. Voce tambem pode testar manualmente pelo historico."}</span>
            </div>
          </section>
        </aside>
      </section>
    </>
  );
}

function StoragePage({ data, refresh, openCreate, showNotice }: { data: AppData; refresh: () => Promise<void>; openCreate: () => void; showNotice: (notice: Notice) => void }) {
  const [busy, setBusy] = useState("");
  const testDestination = async (id: string) => {
    setBusy(id);
    try {
      await api(`/destinations/${id}/test`, { method: "POST", body: "{}" });
      await refresh();
      showNotice({ tone: "success", text: "Conexao testada com sucesso." });
    } catch (err: any) {
      showNotice({ tone: "error", text: err.message });
    } finally {
      setBusy("");
    }
  };
  const deleteDestination = async (id: string) => {
    setBusy(id);
    try {
      await api(`/destinations/${id}`, { method: "DELETE" });
      await refresh();
      showNotice({ tone: "success", text: "Armazenamento removido." });
    } catch (err: any) {
      showNotice({ tone: "error", text: err.message });
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <PageTitle eyebrow="Storage" title="Onde salvar" text="Conexoes Microsoft usadas pelos backups. Segredos da aplicacao ficam no ambiente do servidor." action={<button className="primaryButton" onClick={openCreate}><Plus size={15} /> Conectar</button>} />
      <section className="sectionBlock">
        <StorageList destinations={data.destinations} onTest={testDestination} onDelete={deleteDestination} busy={busy} />
      </section>
    </>
  );
}

function RestorePage({ data, onRunOpen, showNotice }: { data: AppData; onRunOpen: (id: string) => void; showNotice: (notice: Notice) => void }) {
  const [busy, setBusy] = useState("");
  const successfulRuns = data.runs.filter((run) => run.status === "success" || run.status === "verified" || run.status === "recoverable");
  const prepare = async (runId: string) => {
    setBusy(runId);
    try {
      const detail: RunDetail = await api(`/runs/${runId}`);
      if (!detail.artifacts.length) throw new Error("Esta execucao nao possui artefatos.");
      const result = await api("/restores/prepare", { method: "POST", body: JSON.stringify({ artifactId: detail.artifacts[0].id }) });
      showNotice({ tone: "success", text: `Restore pronto: ${result.restore.sourceType}.` });
      onRunOpen(runId);
    } catch (err: any) {
      showNotice({ tone: "error", text: err.message });
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <PageTitle eyebrow="Restore" title="Recuperar dados" text="Escolha um backup concluido, veja o arquivo gerado e prepare o restore com seguranca." />
      <section className="sectionBlock">
        {!successfulRuns.length ? <EmptyState title="Nenhum backup pronto para restore" text="Execute um backup com sucesso para liberar esta etapa." /> : (
          <div className="itemList">
            {successfulRuns.map((run) => (
              <article className="listItem" key={run.id}>
                <div className="itemMain">
                  <strong>{formatDate(run.createdAt)}</strong>
                  <span>{run.id} · {formatBytes(run.bytesWritten)}</span>
                </div>
                <StatusBadge status={run.status} />
                <div className="rowActions">
                  <button className="secondaryButton small" onClick={() => onRunOpen(run.id)}><FileArchive size={14} /> Arquivos</button>
                  <button className="primaryButton small" disabled={busy === run.id} onClick={() => prepare(run.id)}>{busy === run.id ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />} Preparar</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function SettingsPage({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api("/integrations/microsoft/status").then(setStatus).finally(() => setLoading(false));
  }, []);
  return (
    <>
      <PageTitle eyebrow="Settings" title="Configuracoes" text="Estado da instalacao self-hosted, sessao e integracoes operacionais." action={<button className="secondaryButton" onClick={onLogout}><LogOut size={15} /> Sair</button>} />
      <section className="settingsGrid">
        <InfoCard title="Conta" rows={[["Usuario", user.email], ["Perfil", user.role]]} />
        <InfoCard title="Microsoft" rows={loading ? [["Status", "carregando"]] : [["Status", status?.ok ? "conectado" : "falhou"], ["Token", status?.tokenPresent ? "presente" : "ausente"], ["Tipo", status?.tokenType ?? "nao informado"]]} />
        <InfoCard title="Operacao" rows={[["Ambiente", "self-hosted"], ["Segredos", "variaveis do servidor"], ["Interface", "sem expor credenciais sensiveis"]]} />
      </section>
    </>
  );
}

function NewBackupWizard({ data, onClose, onDone }: { data: AppData; onClose: () => void; onDone: (runId?: string) => void }) {
  const preferredDestination = data.destinations.find((destination) => destination.status === "healthy") ?? data.destinations[0];
  const [step, setStep] = useState(1);
  const [sourceType, setSourceType] = useState<SourceType>("postgres");
  const [destinationType, setDestinationType] = useState<DestinationType>("sharepoint");
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [selectedSourceId, setSelectedSourceId] = useState(data.sources.find((source) => source.type === "postgres")?.id ?? "");
  const [selectedDestinationId, setSelectedDestinationId] = useState(preferredDestination?.id ?? "");
  const [sourceName, setSourceName] = useState("Production PostgreSQL");
  const [destinationName, setDestinationName] = useState("SharePoint Backups");
  const [driveTarget, setDriveTarget] = useState("");
  const [routineName, setRoutineName] = useState("Backup diario");
  const [keepLast, setKeepLast] = useState(7);
  const [keepDays, setKeepDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const complete = async () => {
    setBusy(true);
    setError("");
    try {
      let sourceId = selectedSourceId;
      if (!sourceId) {
        const sourceBody = sourceType === "postgres"
          ? { name: sourceName, type: "postgres", config: { host: "postgres", port: 5432, database: "app", username: "postgres" }, secrets: { password: "postgres" } }
          : { name: sourceName || "MinIO uploads", type: "minio", config: { endpoint: "http://minio:9000", bucket: "uploads", prefix: "snapvault-tests" }, secrets: { accessKey: "minioadmin", secretKey: "minioadmin" } };
        const source = await api("/sources", { method: "POST", body: JSON.stringify(sourceBody) });
        sourceId = source.source.id;
      }
      let destinationId = selectedDestinationId;
      if (!destinationId) {
        if (!driveTarget) throw new Error("Escolha um armazenamento existente ou informe um driveId/usuario.");
        const destinationConfig = driveTarget.includes("@") ? { mode: "graph", userPrincipalName: driveTarget } : { mode: "graph", driveId: driveTarget };
        const destination = await api("/destinations", { method: "POST", body: JSON.stringify({ name: destinationName, type: destinationType, basePath: "/SnapVault", config: destinationConfig }) });
        destinationId = destination.destination.id;
      }
      const schedule = frequency === "manual" ? { type: "daily", time: "02:00", timezone: "America/Sao_Paulo" } : { type: frequency, time: "02:00", timezone: "America/Sao_Paulo" };
      const policy = await api("/policies", { method: "POST", body: JSON.stringify({ name: routineName, sourceId, destinationId, schedule, retention: { keepLast, keepDays }, options: { compression: "gzip", encryption: false, verifyAfterUpload: true }, enabled: true }) });
      const run = await api(`/policies/${policy.policy.id}/run`, { method: "POST", body: "{}" });
      onDone(run.runId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const availableSources = data.sources.filter((source) => source.type === sourceType);
  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Novo backup">
      <div className="wizard">
        <header className="wizardHeader">
          <div><span>Novo backup</span><h2>{stepTitle(step)}</h2></div>
          <button className="iconOnly" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </header>
        <Progress step={step} />
        {step === 1 && (
          <ChoiceGrid>
            <Choice active={sourceType === "postgres"} icon={<Database size={18} />} title="PostgreSQL" text="Dump comprimido do banco configurado." onClick={() => { setSourceType("postgres"); setSelectedSourceId(data.sources.find((source) => source.type === "postgres")?.id ?? ""); setSourceName("Production PostgreSQL"); }} />
            <Choice active={sourceType === "minio"} icon={<HardDrive size={18} />} title="MinIO" text="Snapshot do bucket ou prefixo selecionado." onClick={() => { setSourceType("minio"); setSelectedSourceId(data.sources.find((source) => source.type === "minio")?.id ?? ""); setSourceName("MinIO uploads"); }} />
            {availableSources.length > 0 && <Field label="Origem existente"><select value={selectedSourceId} onChange={(e) => setSelectedSourceId(e.target.value)}><option value="">Criar nova origem</option>{availableSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></Field>}
            {!selectedSourceId && <Field label="Nome da origem"><input value={sourceName} onChange={(e) => setSourceName(e.target.value)} /></Field>}
          </ChoiceGrid>
        )}
        {step === 2 && (
          <ChoiceGrid>
            {data.destinations.length > 0 && <div className="choiceSectionTitle">Usar armazenamento existente</div>}
            {[...data.destinations].sort((a, b) => Number(b.status === "healthy") - Number(a.status === "healthy")).map((destination) => (
              <Choice key={destination.id} active={selectedDestinationId === destination.id} icon={<Cloud size={18} />} title={destination.name} text={`${destination.type} em ${destination.basePath}`} onClick={() => { setSelectedDestinationId(destination.id); setDestinationType(destination.type === "onedrive" ? "onedrive" : "sharepoint"); }} />
            ))}
            <div className="choiceSectionTitle">Ou criar novo armazenamento</div>
            <Choice active={!selectedDestinationId && destinationType === "sharepoint"} icon={<Cloud size={18} />} title="SharePoint" text="Salvar em um drive de site Microsoft." onClick={() => { setSelectedDestinationId(""); setDestinationType("sharepoint"); setDestinationName("SharePoint Backups"); }} />
            <Choice active={!selectedDestinationId && destinationType === "onedrive"} icon={<Cloud size={18} />} title="OneDrive" text="Salvar no drive de um usuario Microsoft." onClick={() => { setSelectedDestinationId(""); setDestinationType("onedrive"); setDestinationName("OneDrive Backups"); }} />
            {!selectedDestinationId && <Field label="Nome do armazenamento"><input value={destinationName} onChange={(e) => setDestinationName(e.target.value)} /></Field>}
            {!selectedDestinationId && <Field label="Drive ou usuario"><input value={driveTarget} onChange={(e) => setDriveTarget(e.target.value)} placeholder="driveId ou usuario@empresa.com" /></Field>}
          </ChoiceGrid>
        )}
        {step === 3 && (
          <ChoiceGrid>
            <Choice active={frequency === "daily"} icon={<FolderClock size={18} />} title="Diario" text="Executa todos os dias as 02:00." onClick={() => setFrequency("daily")} />
            <Choice active={frequency === "weekly"} icon={<FolderClock size={18} />} title="Semanal" text="Executa uma vez por semana." onClick={() => setFrequency("weekly")} />
            <Choice active={frequency === "manual"} icon={<Play size={18} />} title="Manual" text="Cria a rotina e executa quando voce pedir." onClick={() => setFrequency("manual")} />
            <Field label="Nome da rotina"><input value={routineName} onChange={(e) => setRoutineName(e.target.value)} /></Field>
            <div className="fieldPair">
              <Field label="Manter no minimo"><input type="number" min={1} value={keepLast} onChange={(e) => setKeepLast(Math.max(1, Number(e.target.value)))} /></Field>
              <Field label="Apagar apos dias"><input type="number" min={0} value={keepDays} onChange={(e) => setKeepDays(Math.max(0, Number(e.target.value)))} /></Field>
            </div>
          </ChoiceGrid>
        )}
        {step === 4 && (
          <div className="reviewBox">
            <ReviewRow label="O que proteger" value={sourceType === "postgres" ? "PostgreSQL" : "MinIO"} />
            <ReviewRow label="Onde salvar" value={selectedDestinationId ? data.destinations.find((item) => item.id === selectedDestinationId)?.name ?? "Armazenamento" : destinationType === "sharepoint" ? "SharePoint" : "OneDrive"} />
            <ReviewRow label="Quando rodar" value={frequency === "daily" ? "Diario, 02:00" : frequency === "weekly" ? "Semanal" : "Manual"} />
            <ReviewRow label="Retencao" value={`manter ${keepLast}; limpar apos ${keepDays} dias`} />
            <ReviewRow label="Primeira execucao" value="Sera iniciada ao concluir" />
          </div>
        )}
        {error && <p className="formError">{error}</p>}
        <footer className="wizardFooter">
          <button className="secondaryButton" onClick={() => step === 1 ? onClose() : setStep(step - 1)}>{step === 1 ? "Cancelar" : <><ChevronLeft size={15} /> Voltar</>}</button>
          {step < 4 ? <button className="primaryButton" onClick={() => setStep(step + 1)}>Continuar</button> : <button className="primaryButton" onClick={complete} disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <Check size={15} />} Criar e executar</button>}
        </footer>
      </div>
    </div>
  );
}

function ConnectStorageModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<DestinationType>("sharepoint");
  const [name, setName] = useState("SharePoint Backups");
  const [target, setTarget] = useState("");
  const [basePath, setBasePath] = useState("/SnapVault");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const config = target.includes("@") ? { mode: "graph", userPrincipalName: target } : { mode: "graph", driveId: target };
      await api("/destinations", { method: "POST", body: JSON.stringify({ name, type, basePath, config }) });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Conectar armazenamento">
      <div className="wizard compactWizard">
        <header className="wizardHeader"><div><span>Storage</span><h2>Conectar armazenamento</h2></div><button className="iconOnly" onClick={onClose} aria-label="Fechar"><X size={18} /></button></header>
        <ChoiceGrid>
          <Choice active={type === "sharepoint"} icon={<Cloud size={18} />} title="SharePoint" text="Drive de um site Microsoft." onClick={() => { setType("sharepoint"); setName("SharePoint Backups"); }} />
          <Choice active={type === "onedrive"} icon={<Cloud size={18} />} title="OneDrive" text="Drive de um usuario Microsoft." onClick={() => { setType("onedrive"); setName("OneDrive Backups"); }} />
          <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Drive ID ou usuario"><input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="driveId ou usuario@empresa.com" /></Field>
          <Field label="Pasta base"><input value={basePath} onChange={(e) => setBasePath(e.target.value)} /></Field>
        </ChoiceGrid>
        {error && <p className="formError">{error}</p>}
        <footer className="wizardFooter"><button className="secondaryButton" onClick={onClose}>Cancelar</button><button className="primaryButton" disabled={busy || !target} onClick={save}>{busy ? <Loader2 className="spin" size={15} /> : <Check size={15} />} Conectar</button></footer>
      </div>
    </div>
  );
}

function RunDetailModal({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/runs/${runId}`).then(setDetail).catch((err) => setError(err.message));
  }, [runId]);
  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Detalhes da execucao">
      <div className="wizard compactWizard">
        <header className="wizardHeader"><div><span>Historico</span><h2>Execucao</h2></div><button className="iconOnly" onClick={onClose} aria-label="Fechar"><X size={18} /></button></header>
        {!detail && !error && <div className="loading mini"><Loader2 className="spin" size={18} /> Carregando</div>}
        {error && <p className="formError">{error}</p>}
        {detail && (
          <div className="detailBody">
            <ReviewRow label="Status" value={statusLabel(detail.run.status)} />
            <ReviewRow label="Integridade" value={verificationLabel(detail.run)} />
            <ReviewRow label="Criado em" value={formatDate(detail.run.createdAt)} />
            <ReviewRow label="Tamanho" value={formatBytes(detail.run.bytesWritten)} />
            <SectionHeader title="Arquivos" />
            {!detail.artifacts.length ? <EmptyState compact title="Sem arquivos" text="A execucao ainda nao gerou artefatos." /> : detail.artifacts.map((artifact) => <div className="artifactRow" key={artifact.id}><FileArchive size={16} /><div><strong>{artifact.path.split(/[\\/]/).pop() ?? artifact.kind}</strong><span>{artifact.path} · {formatBytes(artifact.sizeBytes)}</span></div></div>)}
            <SectionHeader title="Logs" />
            <div className="logBox">{detail.logs.length ? detail.logs.map((log, index) => <code key={index}>{formatDate(log.createdAt)} {log.level}: {log.message}</code>) : <code>Sem logs registrados.</code>}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function AuthMode({ mode, error, setError, onDone }: { mode: "setup" | "login"; error: string; setError: (value: string) => void; onDone: (user: any) => void }) {
  const [name, setName] = useState("Admin");
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("password123");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const path = mode === "setup" ? "/setup/admin" : "/auth/login";
      const body = mode === "setup" ? { name, email, password } : { email, password };
      const result = await api(path, { method: "POST", body: JSON.stringify(body) });
      onDone(result.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AppShell>
      <form className="authCard" onSubmit={submit}>
        <div className="authMark"><KeyRound size={19} /></div>
        <h1>{mode === "setup" ? "Criar administrador" : "Entrar no SnapVault"}</h1>
        <p>Backups automaticos para PostgreSQL e MinIO, com restore e historico em um lugar simples.</p>
        {mode === "setup" && <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>}
        <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Senha"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <p className="formError">{error}</p>}
        <button className="primaryButton full" disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : null}{mode === "setup" ? "Comecar" : "Entrar"}</button>
      </form>
    </AppShell>
  );
}

function SetupChecklist({ data, onNewBackup }: { data: AppData; onNewBackup: () => void }) {
  const items = [["Conectar origem", data.sources.length > 0], ["Conectar destino", data.destinations.length > 0], ["Criar backup automatico", data.policies.length > 0], ["Executar primeiro backup", data.runs.some((run) => run.status === "success" || run.status === "verified" || run.status === "recoverable")], ["Verificar integridade", data.runs.some((run) => run.status === "verified" || run.status === "recoverable" || run.verificationStatus === "integrity_verified")], ["Testar restore", data.runs.some((run) => run.status === "recoverable" || run.verificationStatus === "restore_verified")]] as const;
  return <section className="card"><SectionHeader title="Proximos passos" /><div className="checkList">{items.map(([label, done]) => <div className="checkItem" key={label}><span className={done ? "done" : ""}>{done ? <Check size={13} /> : null}</span>{label}</div>)}</div><button className="secondaryButton full" onClick={onNewBackup}>Configurar backup</button></section>;
}

function BackupList({ data, onRun, onPolicyOpen, busy, limit, onToggle, onDelete }: { data: AppData; onRun: (id: string) => void; onRunOpen: (id: string) => void; onPolicyOpen: (id: string) => void; busy: string; limit?: number; onToggle?: (policy: BackupRoutine) => void; onDelete?: (id: string) => void }) {
  const items = limit ? data.policies.slice(0, limit) : data.policies;
  if (!items.length) return <EmptyState title="Nenhum backup automatico" text="Crie seu primeiro backup para proteger PostgreSQL ou MinIO." />;
  return (
    <div className="itemList">
      {items.map((policy) => {
        const source = data.sources.find((item) => item.id === policy.sourceId);
        const destination = data.destinations.find((item) => item.id === policy.destinationId);
        const lastRun = data.runs.find((run) => run.policyId === policy.id);
        return (
          <article className="listItem" key={policy.id}>
            <button className="itemMain itemButton" onClick={() => onPolicyOpen(policy.id)}>
              <strong>{policy.name}</strong>
              <span>{source?.type ?? "origem"} para {destination?.type ?? "armazenamento"} · {policy.enabled ? "ativo" : "pausado"}</span>
            </button>
            <StatusBadge status={policy.enabled ? lastRun?.status ?? "ready" : "paused"} />
            <div className="rowActions">
              <button className="secondaryButton small" disabled={busy === policy.id} onClick={() => onRun(policy.id)}>{busy === policy.id ? <Loader2 className="spin" size={14} /> : <Play size={14} />} Rodar</button>
              {onToggle && <button className="secondaryButton small" disabled={busy === policy.id} onClick={() => onToggle(policy)}><Pause size={14} /> {policy.enabled ? "Pausar" : "Ativar"}</button>}
              {onDelete && <button className="iconOnly danger" disabled={busy === policy.id} onClick={() => onDelete(policy.id)} aria-label="Remover backup"><Trash2 size={15} /></button>}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function StorageList({ destinations, onTest, onDelete, busy }: { destinations: Destination[]; onTest: (id: string) => void; onDelete: (id: string) => void; busy: string }) {
  if (!destinations.length) return <EmptyState title="Nenhum armazenamento" text="Conecte SharePoint ou OneDrive para salvar seus backups." />;
  return <div className="itemList">{destinations.map((destination) => <article className="listItem" key={destination.id}><div className="itemMain"><strong>{destination.name}</strong><span>{destination.type} em {destination.basePath}</span></div><StatusBadge status={destination.status} /><div className="rowActions"><button className="secondaryButton small" disabled={busy === destination.id} onClick={() => onTest(destination.id)}>{busy === destination.id ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />} Testar</button><button className="iconOnly danger" disabled={busy === destination.id} onClick={() => onDelete(destination.id)} aria-label="Remover armazenamento"><Trash2 size={15} /></button></div></article>)}</div>;
}

function RecentRuns({ runs, onOpen }: { runs: Run[]; onOpen: (id: string) => void }) {
  return <section className="card"><SectionHeader title="Execucoes recentes" />{!runs.length ? <EmptyState title="Sem historico" text="As execucoes aparecem aqui depois do primeiro backup." compact /> : <div className="runList">{runs.slice(0, 4).map((run) => <button className="runItem" key={run.id} onClick={() => onOpen(run.id)}><StatusBadge status={run.status} /><code>{run.id}</code><span>{formatBytes(run.bytesWritten)}</span></button>)}</div>}</section>;
}

function InfoCard({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return <section className="card"><SectionHeader title={title} /><div className="reviewBox compactReview">{rows.map(([label, value]) => <ReviewRow key={label} label={label} value={value} />)}</div></section>;
}

function TrustCard({ title, value, tone }: { title: string; value: string; tone?: "ok" | "warn" }) {
  return <section className="trustCard"><span>{title}</span><strong>{value}</strong><i className={tone ?? "neutral"} /></section>;
}

function PageTitle({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) {
  return <header className="pageTitle"><div><span>{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{action}</header>;
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return <div className="sectionHeader"><h2>{title}</h2>{action}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function ChoiceGrid({ children }: { children: React.ReactNode }) {
  return <div className="choiceGrid">{children}</div>;
}

function Choice({ active, icon, title, text, onClick }: { active: boolean; icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return <button className={`choice ${active ? "selected" : ""}`} onClick={onClick}>{icon}<strong>{title}</strong><span>{text}</span></button>;
}

function Progress({ step }: { step: number }) {
  return <div className="progress">{[1, 2, 3, 4].map((item) => <span key={item} className={item <= step ? "active" : ""} />)}</div>;
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return <div className="reviewRow"><span>{label}</span><strong>{value}</strong></div>;
}

function StatusBadge({ status }: { status: string }) {
  const label = statusLabel(status);
  return <span className={`statusBadge ${status}`}>{label}</span>;
}

function EmptyState({ title, text, compact }: { title: string; text: string; compact?: boolean }) {
  return <div className={`emptyState ${compact ? "compactEmpty" : ""}`}><strong>{title}</strong><span>{text}</span></div>;
}

function LoadingState() {
  return <div className="loading"><Loader2 className="spin" size={18} /> Carregando</div>;
}

function stepTitle(step: number) {
  return ["", "O que proteger?", "Onde salvar?", "Quando rodar?", "Revisar"][step];
}

function statusLabel(status: string) {
  return status === "success" ? "enviado" : status === "verified" ? "verificado" : status === "recoverable" ? "restore testado" : status === "restore_failed" ? "restore falhou" : status === "failed" ? "falhou" : status === "healthy" ? "conectado" : status === "ready" ? "pronto" : status === "untested" ? "nao testado" : status === "paused" ? "pausado" : status;
}

function verificationLabel(run: Run) {
  if (run.status === "recoverable" || run.verificationStatus === "restore_verified") return "restore testado";
  if (run.status === "verified" || run.verificationStatus === "integrity_verified") return "checksum e estrutura ok";
  return "nao verificado";
}

function scheduleLabel(policy: BackupRoutine) {
  const type = policy.schedule?.type;
  const time = policy.schedule?.time ?? "02:00";
  if (type === "weekly") return `semanal, ${time}`;
  if (type === "daily") return `diario, ${time}`;
  return "manual";
}

function retentionLabel(policy: BackupRoutine) {
  const keepLast = policy.retention?.keepLast ?? 7;
  const keepDays = policy.retention?.keepDays ?? 30;
  return `manter ${keepLast}; limpar apos ${keepDays} dias`;
}

function formatBytes(value: number | null) {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

createRoot(document.getElementById("root")!).render(<App />);
