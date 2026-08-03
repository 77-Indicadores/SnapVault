import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  Check,
  ChevronLeft,
  Cloud,
  Copy,
  Database,
  FileArchive,
  FolderClock,
  HardDrive,
  KeyRound,
  Loader2,
  LogOut,
  Pause,
  Pencil,
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
  const headers = options.body ? { "Content-Type": "application/json", ...(options.headers ?? {}) } : options.headers;
  const res = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: "include"
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("sv:session-expired"));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message ?? "Request failed");
  return data;
};

type View = "overview" | "backups" | "sources" | "storage" | "settings";
type SourceType = "postgres" | "minio";
type DestinationType = "sharepoint" | "onedrive";
type Frequency = "manual" | "daily" | "weekly";
type Source = { id: string; name: string; type: SourceType | string; status: string; config?: any; metadata?: any; lastTestedAt?: string | null };
type Destination = { id: string; name: string; type: DestinationType | string; status: string; basePath: string; config?: any; metadata?: any; lastTestedAt?: string | null };
type BackupRoutine = { id: string; name: string; sourceId: string; destinationId: string; sourceScope?: SourceScope; enabled: boolean; schedule?: { type: string; time?: string; weekday?: number; timezone?: string }; retention?: { keepLast: number; keepDays: number } };
type Run = { id: string; policyId: string; sourceId?: string; destinationId?: string; status: string; verificationStatus?: string; verifiedAt?: string | null; createdAt: string; finishedAt?: string | null; bytesWritten: number | null; errorMessage: string | null };
type Artifact = { id: string; kind: string; path: string; sizeBytes: number | null; checksumSha256: string | null };
type RunDetailData = { run: Run; logs: Array<{ message: string; level: string; createdAt: string; data?: any }>; artifacts: Artifact[] };
type AppData = { sources: Source[]; destinations: Destination[]; policies: BackupRoutine[]; runs: Run[] };
type Notice = { tone: "success" | "error"; text: string } | null;
type RestoreRequest = { runId: string; artifact: Artifact; sourceType: string };
type SourceScope = { mode: "single" | "all"; database?: string; bucket?: string; prefix?: string };
type MicrosoftSite = { id: string; displayName?: string; name?: string; webUrl?: string };
type MicrosoftDrive = { id: string; name: string; webUrl?: string; quota?: any };
type MicrosoftUser = { id: string; displayName?: string; mail?: string; userPrincipalName?: string };
type MicrosoftIntegration = { id: string; name: string; tenantId: string; clientId: string; clientSecretSet: boolean; status: string; lastTestedAt?: string | null };

const emptyData: AppData = { sources: [], destinations: [], policies: [], runs: [] };

function App() {
  const [setup, setSetup] = useState<boolean | null>(null);
  const [user, setUser] = useState<any>(null);
  const [data, setData] = useState<AppData>(emptyData);
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [view, setView] = useState<View>("overview");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [storageOpen, setStorageOpen] = useState(false);
  const [editingStorage, setEditingStorage] = useState<Destination | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [editingPolicy, setEditingPolicy] = useState<BackupRoutine | null>(null);
  const [restoreRequest, setRestoreRequest] = useState<RestoreRequest | null>(null);
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

  const hasActiveJobs = data.runs.some((r) => r.status === "queued" || r.status === "running");

  useEffect(() => {
    fetch("/api/v1/setup/status").then((r) => r.json()).then(async (status) => {
      setSetup(status.requiresSetup);
      if (!status.requiresSetup) {
        try {
          const me = await api("/auth/me");
          setUser(me.user);
          const [, settings] = await Promise.all([refresh(), api("/settings")]);
          const tz = settings.timezone ?? "America/Sao_Paulo";
          setTimezone(tz);
          setSystemTimezone(tz);
        } catch {
          setUser(null);
        }
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user || !hasActiveJobs) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [user, hasActiveJobs]);

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener("sv:session-expired", onExpired);
    return () => window.removeEventListener("sv:session-expired", onExpired);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (wizardOpen) { setWizardOpen(false); return; }
      if (sourceOpen) { setSourceOpen(false); return; }
      if (editingSource) { setEditingSource(null); return; }
      if (storageOpen) { setStorageOpen(false); return; }
      if (editingStorage) { setEditingStorage(null); return; }
      if (editingPolicy) { setEditingPolicy(null); return; }
      if (restoreRequest) { setRestoreRequest(null); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wizardOpen, sourceOpen, editingSource, storageOpen, editingStorage, editingPolicy, restoreRequest]);

  const runNow = async (policyId: string) => {
    setBusy(policyId);
    try {
      await api(`/policies/${policyId}/run`, { method: "POST", body: "{}" });
      showNotice({ tone: "success", text: "Backup iniciado." });
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
    if (!window.confirm("Remover esta rotina de backup? Esta ação não pode ser desfeita.")) return;
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
    <AppShell user={user} view={view} setView={setView} onNewBackup={() => setWizardOpen(true)} timezone={timezone}>
      {notice && <div className={`toast ${notice.tone}`} role="status" aria-live="polite">{notice.text}</div>}
      {view === "overview" && <OverviewPage data={data} onNewBackup={() => setWizardOpen(true)} onRun={runNow} onPolicyOpen={(id) => { setSelectedPolicyId(id); setView("backups"); }} busy={busy} />}
      {view === "backups" && (selectedPolicyId ? <BackupDetailPage data={data} policyId={selectedPolicyId} onBack={() => setSelectedPolicyId("")} onRun={runNow} onEdit={setEditingPolicy} onRestore={setRestoreRequest} onToggle={togglePolicy} refresh={refresh} showNotice={showNotice} busy={busy} /> : <BackupsPage data={data} onNewBackup={() => setWizardOpen(true)} onRun={runNow} onPolicyOpen={setSelectedPolicyId} onEdit={setEditingPolicy} onToggle={togglePolicy} onDelete={deletePolicy} busy={busy} />)}
      {view === "sources" && <SourcesPage data={data} refresh={refresh} openCreate={() => setSourceOpen(true)} openEdit={setEditingSource} showNotice={showNotice} />}
      {view === "storage" && <StoragePage data={data} refresh={refresh} openCreate={() => setStorageOpen(true)} openEdit={setEditingStorage} showNotice={showNotice} />}
      {view === "settings" && <SettingsPage user={user} onLogout={logout} showNotice={showNotice} timezone={timezone} onTimezoneChange={(tz) => { setTimezone(tz); setSystemTimezone(tz); }} />}
      {wizardOpen && <NewBackupWizard data={data} onCreateSource={() => setSourceOpen(true)} onCreateStorage={() => setStorageOpen(true)} onClose={() => setWizardOpen(false)} onDone={async () => { setWizardOpen(false); await refresh(); setView("overview"); showNotice({ tone: "success", text: "Rotina criada e primeira execucao iniciada." }); }} />}
      {sourceOpen && <SourceWizard onClose={() => setSourceOpen(false)} onDone={async () => { setSourceOpen(false); await refresh(); showNotice({ tone: "success", text: "Origem conectada e testada." }); }} />}
      {editingSource && <SourceWizard source={editingSource} onClose={() => setEditingSource(null)} onDone={async () => { setEditingSource(null); await refresh(); showNotice({ tone: "success", text: "Origem atualizada." }); }} />}
      {storageOpen && <StorageWizard onClose={() => setStorageOpen(false)} onDone={async () => { setStorageOpen(false); await refresh(); showNotice({ tone: "success", text: "Armazenamento conectado e testado." }); }} />}
      {editingStorage && <StorageWizard destination={editingStorage} onClose={() => setEditingStorage(null)} onDone={async () => { setEditingStorage(null); await refresh(); showNotice({ tone: "success", text: "Armazenamento atualizado." }); }} />}
      {editingPolicy && <PolicyWizard data={data} policy={editingPolicy} onClose={() => setEditingPolicy(null)} onDone={async () => { setEditingPolicy(null); await refresh(); showNotice({ tone: "success", text: "Rotina atualizada." }); }} />}
      {restoreRequest && <RestoreExecuteModal data={data} request={restoreRequest} onClose={() => setRestoreRequest(null)} onDone={async () => { setRestoreRequest(null); await refresh(); showNotice({ tone: "success", text: "Restore executado com sucesso." }); }} />}
    </AppShell>
  );
}

function SystemClock({ timezone }: { timezone: string }) {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const formatted = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(time);
  const abbr = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, timeZoneName: "short" }).formatToParts(time).find((p) => p.type === "timeZoneName")?.value ?? "";
  return <span className="systemClock" title={timezone}>{formatted} <span className="clockTz">{abbr}</span></span>;
}

function AppShell({ children, user, view, setView, onNewBackup, timezone }: { children: React.ReactNode; user?: any; view?: View; setView?: (view: View) => void; onNewBackup?: () => void; timezone?: string }) {
  const nav: Array<[View, string]> = [["overview", "Overview"], ["backups", "Backups"], ["sources", "Sources"], ["storage", "Storage"], ["settings", "Settings"]];
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
              {timezone && <SystemClock timezone={timezone} />}
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

function OverviewPage({ data, onNewBackup, onRun, onPolicyOpen, busy }: { data: AppData; onNewBackup: () => void; onRun: (id: string) => void; onPolicyOpen: (id: string) => void; busy: string }) {
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
        <RecentRuns runs={data.runs} />
      </section>
      <section className="sectionBlock">
        <SectionHeader title="Backups configurados" action={<button className="secondaryButton" onClick={onNewBackup}><Plus size={15} /> Adicionar</button>} />
        <BackupList data={data} onRun={onRun} onPolicyOpen={onPolicyOpen} busy={busy} limit={4} />
      </section>
    </>
  );
}

function BackupsPage(props: { data: AppData; onNewBackup: () => void; onRun: (id: string) => void; onPolicyOpen: (id: string) => void; onEdit: (policy: BackupRoutine) => void; onToggle: (policy: BackupRoutine) => void; onDelete: (id: string) => void; busy: string }) {
  return (
    <>
      <PageTitle eyebrow="Backups" title="Rotinas de backup" text="Cada rotina define o que proteger, onde salvar e quando executar." />
      <section className="sectionBlock">
        <BackupList {...props} />
      </section>
    </>
  );
}

function BackupDetailPage({ data, policyId, onBack, onRun, onEdit, onRestore, onToggle, refresh, showNotice, busy }: { data: AppData; policyId: string; onBack: () => void; onRun: (id: string) => void; onEdit: (policy: BackupRoutine) => void; onRestore: (request: RestoreRequest) => void; onToggle: (policy: BackupRoutine) => void; refresh: () => Promise<void>; showNotice: (notice: Notice) => void; busy: string }) {
  const [restoreBusy, setRestoreBusy] = useState("");
  const [testBusy, setTestBusy] = useState("");
  const [panelRunId, setPanelRunId] = useState("");
  const policy = data.policies.find((item) => item.id === policyId);
  if (!policy) return <EmptyState title="Backup nao encontrado" text="A rotina pode ter sido removida." />;
  const source = data.sources.find((item) => item.id === policy.sourceId);
  const destination = data.destinations.find((item) => item.id === policy.destinationId);
  const runs = data.runs.filter((run) => run.policyId === policy.id);
  const latest = runs[0];
  const verified = latest?.status === "verified" || latest?.status === "recoverable" || latest?.verificationStatus === "integrity_verified";
  const recoverable = latest?.status === "recoverable" || latest?.verificationStatus === "restore_verified";
  const restoreFailed = latest?.status === "restore_failed";
  const isAllScope = (policy.sourceScope as any)?.mode === "all";
  const isPg = source?.type === "postgres";

  const prepareRestore = async (runId: string) => {
    setRestoreBusy(runId);
    try {
      const detail: RunDetailData = await api(`/runs/${runId}`);
      if (!detail.artifacts.length) throw new Error("Esta execucao nao possui artefatos.");
      const artifact = detail.artifacts.find((item) => item.kind !== "manifest") ?? detail.artifacts[0];
      onRestore({ runId, artifact, sourceType: source?.type ?? String(detail.run.sourceId ?? "") });
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
      setPanelRunId(runId);
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
          <button className="secondaryButton" onClick={() => onEdit(policy)}><Pencil size={15} /> Editar</button>
          <button className="secondaryButton" disabled={busy === policy.id} onClick={() => onToggle(policy)}>{policy.enabled ? <Pause size={15} /> : <Play size={15} />} {policy.enabled ? "Pausar" : "Ativar"}</button>
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
                  <button className={`itemMain itemButton${panelRunId === run.id ? " active" : ""}`} onClick={() => setPanelRunId(panelRunId === run.id ? "" : run.id)}>
                    <strong>{formatDate(run.createdAt)}</strong>
                    <span>{run.id} · {verificationLabel(run)} · {formatBytes(run.bytesWritten)}</span>
                  </button>
                  <StatusBadge status={run.status} />
                  <div className="rowActions">
                    <button className="secondaryButton small" onClick={() => setPanelRunId(panelRunId === run.id ? "" : run.id)}><FileArchive size={14} /> Detalhes</button>
                    {!(isPg && isAllScope) && <button className="secondaryButton small" disabled={testBusy === run.id} onClick={() => testRestore(run.id)}>{testBusy === run.id ? <Loader2 className="spin" size={14} /> : <ShieldCheck size={14} />} Testar restore</button>}
                    <button className="primaryButton small" disabled={restoreBusy === run.id} onClick={() => prepareRestore(run.id)}>{restoreBusy === run.id ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />} Recuperar</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <aside className="detailSide">
          {panelRunId ? (
            <section className="card runPanel">
              <header className="runPanelHeader">
                <span>Execucao</span>
                <button className="iconOnly" onClick={() => setPanelRunId("")} aria-label="Fechar painel"><X size={16} /></button>
              </header>
              <RunDetail runId={panelRunId} />
            </section>
          ) : (
            <>
              <InfoCard title="Configuracao" rows={[["Origem", source?.name ?? "nao encontrada"], ["Escopo", source ? sourceScopeLabel(source.type as SourceType, policySourceScope(policy, source)) : "-"], ["Destino", destination?.name ?? "nao encontrado"], ["Pasta", destination?.basePath ?? "-"], ["Frequencia", scheduleLabel(policy)], ["Retencao", retentionLabel(policy)]]} />
              <section className="card">
                <SectionHeader title="Recuperacao" />
                <div className="sideCopy">
                  {isPg && isAllScope ? (
                    <>
                      <strong>Restore manual necessario</strong>
                      <span>Esta rotina usa <code>pg_dumpall</code> (todas as databases). O restore automatico nao e suportado para este escopo — use o arquivo gerado com <code>psql</code> manualmente.</span>
                    </>
                  ) : (
                    <>
                      <strong>{recoverable ? "Restore validado" : restoreFailed ? "Restore falhou" : "Restore ainda nao validado"}</strong>
                      <span>{recoverable ? "Esta rotina possui evidencia de recuperacao." : restoreFailed ? "O arquivo existe, mas o restore automatico falhou. Abra a execucao para ver os logs." : "O restore automatico roda apos cada backup verificado. Voce tambem pode testar manualmente pelo historico."}</span>
                    </>
                  )}
                </div>
              </section>
            </>
          )}
        </aside>
      </section>
    </>
  );
}

function StoragePage({ data, refresh, openCreate, openEdit, showNotice }: { data: AppData; refresh: () => Promise<void>; openCreate: () => void; openEdit: (destination: Destination) => void; showNotice: (notice: Notice) => void }) {
  const [busy, setBusy] = useState("");
  const dependencyCount = (id: string) => data.policies.filter((item) => item.destinationId === id).length + data.runs.filter((item) => item.destinationId === id).length;
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
  const archiveDestination = async (destination: Destination) => {
    setBusy(destination.id);
    try {
      const path = destination.status === "archived" ? "reactivate" : "archive";
      await api(`/destinations/${destination.id}/${path}`, { method: "POST", body: "{}" });
      await refresh();
      showNotice({ tone: "success", text: destination.status === "archived" ? "Armazenamento reativado. Teste antes de usar." : "Armazenamento arquivado e rotinas vinculadas pausadas." });
    } catch (err: any) {
      showNotice({ tone: "error", text: err.message });
    } finally {
      setBusy("");
    }
  };
  const deleteDestination = async (destination: Destination) => {
    if (dependencyCount(destination.id) > 0) return archiveDestination(destination);
    setBusy(destination.id);
    try {
      await api(`/destinations/${destination.id}`, { method: "DELETE" });
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
      <PageTitle eyebrow="Storage" title="Onde salvar" text="Conexoes Microsoft usadas pelos backups. Escolha site, biblioteca e pasta sem digitar IDs." action={<button className="primaryButton" onClick={openCreate}><Plus size={15} /> Conectar</button>} />
      <section className="sectionBlock">
        <StorageList destinations={data.destinations} dependencyCount={dependencyCount} onTest={testDestination} onEdit={openEdit} onArchive={archiveDestination} onDelete={deleteDestination} busy={busy} />
      </section>
    </>
  );
}

function SourcesPage({ data, refresh, openCreate, openEdit, showNotice }: { data: AppData; refresh: () => Promise<void>; openCreate: () => void; openEdit: (source: Source) => void; showNotice: (notice: Notice) => void }) {
  const [busy, setBusy] = useState("");
  const dependencyCount = (id: string) => data.policies.filter((item) => item.sourceId === id).length + data.runs.filter((item) => item.sourceId === id).length;
  const testSource = async (id: string) => {
    setBusy(id);
    try {
      await api(`/sources/${id}/test`, { method: "POST", body: "{}" });
      await refresh();
      showNotice({ tone: "success", text: "Origem testada com sucesso." });
    } catch (err: any) {
      showNotice({ tone: "error", text: err.message });
    } finally {
      setBusy("");
    }
  };
  const deleteSource = async (source: Source) => {
    setBusy(source.id);
    try {
      const deps = dependencyCount(source.id);
      if (source.status === "archived") {
        await api(`/sources/${source.id}/reactivate`, { method: "POST", body: "{}" });
      } else if (deps > 0) {
        await api(`/sources/${source.id}/archive`, { method: "POST", body: "{}" });
      } else {
        await api(`/sources/${source.id}`, { method: "DELETE" });
      }
      await refresh();
      showNotice({ tone: "success", text: source.status === "archived" ? "Origem reativada. Teste antes de usar." : deps > 0 ? "Origem arquivada e rotinas vinculadas pausadas." : "Origem removida." });
    } catch (err: any) {
      showNotice({ tone: "error", text: err.message });
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <PageTitle eyebrow="Sources" title="O que proteger" text="Conexoes PostgreSQL e MinIO. Teste a conexao, liste databases ou buckets e defina o escopo." action={<button className="primaryButton" onClick={openCreate}><Plus size={15} /> Conectar</button>} />
      <section className="sectionBlock">
        {!data.sources.length ? <EmptyState title="Nenhuma origem" text="Conecte PostgreSQL ou MinIO antes de criar uma rotina." /> : (
          <div className="itemList">{data.sources.map((source) => {
            const deps = dependencyCount(source.id);
            const actionText = source.status === "archived" ? "Reativar" : deps > 0 ? "Arquivar" : "Excluir";
            const endpoint = source.type === "postgres" ? `${source.config?.host ?? "-"}:${source.config?.port ?? 5432}` : source.config?.endpoint ?? "-";
            return <article className="listItem" key={source.id}><div className="itemMain"><strong>{source.name}</strong><span>{source.type} · {endpoint}</span></div><StatusBadge status={source.status} /><div className="rowActions"><button className="secondaryButton small" disabled={busy === source.id || source.status === "archived"} onClick={() => testSource(source.id)}>{busy === source.id ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />} Testar</button><button className="secondaryButton small" onClick={() => openEdit(source)}><Pencil size={14} /> Editar</button><button className="secondaryButton small" disabled={busy === source.id} onClick={() => deleteSource(source)}>{source.status === "archived" ? <RefreshCw size={14} /> : <Trash2 size={14} />} {actionText}</button></div></article>;
          })}</div>
        )}
      </section>
    </>
  );
}

function RestorePage({ data, showNotice }: { data: AppData; showNotice: (notice: Notice) => void }) {
  const [busy, setBusy] = useState("");
  const [openRunId, setOpenRunId] = useState("");
  const successfulRuns = data.runs.filter((run) => run.status === "success" || run.status === "verified" || run.status === "recoverable");
  const prepare = async (runId: string) => {
    setBusy(runId);
    try {
      const detail: RunDetailData = await api(`/runs/${runId}`);
      if (!detail.artifacts.length) throw new Error("Esta execucao nao possui artefatos.");
      const result = await api("/restores/prepare", { method: "POST", body: JSON.stringify({ artifactId: detail.artifacts[0].id }) });
      showNotice({ tone: "success", text: `Restore pronto: ${result.restore.sourceType}.` });
      setOpenRunId(runId);
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
                  <button className={`itemButton${openRunId === run.id ? " active" : ""}`} onClick={() => setOpenRunId(openRunId === run.id ? "" : run.id)}>
                    <strong>{formatDate(run.createdAt)}</strong>
                    <span>{run.id} · {formatBytes(run.bytesWritten)}</span>
                  </button>
                </div>
                <StatusBadge status={run.status} />
                <div className="rowActions">
                  <button className="secondaryButton small" onClick={() => setOpenRunId(openRunId === run.id ? "" : run.id)}><FileArchive size={14} /> Detalhes</button>
                  <button className="primaryButton small" disabled={busy === run.id} onClick={() => prepare(run.id)}>{busy === run.id ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />} Preparar</button>
                </div>
                {openRunId === run.id && (
                  <div className="runItemDetail">
                    <RunDetail runId={run.id} />
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

const TIMEZONE_OPTIONS = [
  { value: "America/Sao_Paulo", label: "Brasília (BRT / BRST) — padrão" },
  { value: "America/Manaus", label: "Manaus (AMT)" },
  { value: "America/Belem", label: "Belém (BRT)" },
  { value: "America/Fortaleza", label: "Fortaleza (BRT)" },
  { value: "America/Recife", label: "Recife (BRT)" },
  { value: "America/Porto_Velho", label: "Porto Velho (AMT)" },
  { value: "America/Boa_Vista", label: "Boa Vista (AMT)" },
  { value: "America/Cuiaba", label: "Cuiabá (AMT / AMST)" },
  { value: "America/Noronha", label: "Fernando de Noronha (FNT)" },
  { value: "America/Rio_Branco", label: "Rio Branco (ACT)" },
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "New York (ET)" },
  { value: "Europe/Lisbon", label: "Lisboa (WET / WEST)" },
  { value: "Europe/London", label: "Londres (GMT / BST)" },
];

function SettingsPage({ user, onLogout, showNotice, timezone, onTimezoneChange }: { user: any; onLogout: () => void; showNotice: (notice: Notice) => void; timezone: string; onTimezoneChange: (tz: string) => void }) {
  const [tzBusy, setTzBusy] = useState(false);

  const saveTimezone = async (tz: string) => {
    setTzBusy(true);
    try {
      await api("/settings", { method: "PATCH", body: JSON.stringify({ timezone: tz }) });
      onTimezoneChange(tz);
      showNotice({ tone: "success", text: "Timezone atualizado." });
    } catch (err: any) {
      showNotice({ tone: "error", text: err.message });
    } finally {
      setTzBusy(false);
    }
  };

  return (
    <>
      <PageTitle eyebrow="Settings" title="Configuracoes" text="Estado da instalacao self-hosted, sessao e integracoes operacionais." action={<button className="secondaryButton" onClick={onLogout}><LogOut size={15} /> Sair</button>} />
      <section className="settingsGrid">
        <InfoCard title="Conta" rows={[["Usuario", user.email], ["Perfil", user.role]]} />
        <InfoCard title="Operacao" rows={[["Ambiente", "self-hosted"], ["Segredos", "criptografados localmente"], ["Interface", "sem expor secret salvo"]]} />
      </section>
      <section className="card">
        <SectionHeader title="Timezone do sistema" />
        <div className="sideCopy">
          <strong>Fuso horario de referencia</strong>
          <span>Define como agendamentos sao interpretados e como horarios sao exibidos no sistema. O relogio na barra superior reflete este timezone.</span>
        </div>
        <div className="tzSelector">
          <select value={timezone} onChange={(e) => saveTimezone(e.target.value)} disabled={tzBusy}>
            {TIMEZONE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          {tzBusy && <Loader2 className="spin" size={15} />}
        </div>
      </section>
      <MicrosoftIntegrationsPanel showNotice={showNotice} />
    </>
  );
}

function MicrosoftIntegrationsPanel({ showNotice }: { showNotice: (notice: Notice) => void }) {
  const [items, setItems] = useState<MicrosoftIntegration[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const selected = items.find((item) => item.id === selectedId);
  const [name, setName] = useState("Microsoft principal");
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState("");
  const load = async () => {
    const result = await api("/integrations/microsoft");
    setItems(result.integrations ?? []);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!selected) return;
    setName(selected.name);
    setTenantId(selected.tenantId);
    setClientId(selected.clientId);
    setClientSecret("");
  }, [selectedId]);
  const save = async () => {
    setBusy("save");
    try {
      const payload: any = { name, tenantId, clientId };
      if (clientSecret) payload.clientSecret = clientSecret;
      if (selectedId) await api(`/integrations/microsoft/${selectedId}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await api("/integrations/microsoft", { method: "POST", body: JSON.stringify(payload) });
      await load();
      setClientSecret("");
      showNotice({ tone: "success", text: "Integracao Microsoft salva." });
    } catch (err: any) {
      showNotice({ tone: "error", text: err.message });
    } finally {
      setBusy("");
    }
  };
  const test = async () => {
    if (!selectedId) return showNotice({ tone: "error", text: "Salve a integracao antes de testar." });
    setBusy("test");
    try {
      await api(`/integrations/microsoft/${selectedId}/test`, { method: "POST", body: "{}" });
      await load();
      showNotice({ tone: "success", text: "Microsoft Graph conectado." });
    } catch (err: any) {
      showNotice({ tone: "error", text: err.message });
    } finally {
      setBusy("");
    }
  };
  const reset = () => {
    setSelectedId("");
    setName("Microsoft principal");
    setTenantId("");
    setClientId("");
    setClientSecret("");
  };
  return (
    <section className="sectionBlock settingsPanel">
      <SectionHeader title="Multiplas integracoes Microsoft" action={<button className="secondaryButton small" onClick={reset}><Plus size={14} /> Nova</button>} />
      {items.length > 0 && <div className="integrationStrip">{items.map((item) => <button key={item.id} className={selectedId === item.id ? "selected" : ""} onClick={() => setSelectedId(item.id)}><span>{item.name}</span><StatusBadge status={item.status} /></button>)}</div>}
      <div className="formGrid">
        <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Microsoft Cliente A" /></Field>
        <Field label="Tenant ID"><input value={tenantId} onChange={(e) => setTenantId(e.target.value)} /></Field>
        <Field label="Client ID"><input value={clientId} onChange={(e) => setClientId(e.target.value)} /></Field>
        <Field label={selected?.clientSecretSet ? "Client Secret novo opcional" : "Client Secret"}><input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} /></Field>
      </div>
      <div className="settingsHint">Cada Storage escolhe uma integracao Microsoft. O secret salvo nunca e exibido de volta.</div>
      <div className="footerActions">
        <button className="secondaryButton" disabled={busy === "test" || !selectedId} onClick={test}>{busy === "test" ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />} Testar conexao</button>
        <button className="primaryButton" disabled={busy === "save" || !tenantId || !clientId || (!clientSecret && !selected?.clientSecretSet)} onClick={save}>{busy === "save" ? <Loader2 className="spin" size={15} /> : <Check size={15} />} Salvar</button>
      </div>
    </section>
  );
}

function NewBackupWizard({ data, onCreateSource, onCreateStorage, onClose, onDone }: { data: AppData; onCreateSource: () => void; onCreateStorage: () => void; onClose: () => void; onDone: (runId?: string) => void }) {
  const healthyDestinations = data.destinations.filter(isUsableDestination);
  const preferredDestination = healthyDestinations[0];
  const [step, setStep] = useState(1);
  const [sourceType, setSourceType] = useState<SourceType>("postgres");
  const [destinationType, setDestinationType] = useState<DestinationType>("sharepoint");
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [selectedSourceId, setSelectedSourceId] = useState(data.sources.find((source) => source.type === "postgres" && source.status === "healthy")?.id ?? "");
  const [selectedDestinationId, setSelectedDestinationId] = useState(preferredDestination?.id ?? "");
  const [scopeMode, setScopeMode] = useState<"single" | "all">("single");
  const [selectedResource, setSelectedResource] = useState("");
  const [prefix, setPrefix] = useState("");
  const [resourceOptions, setResourceOptions] = useState<string[]>([]);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [routineName, setRoutineName] = useState("Backup diario");
  const [keepLast, setKeepLast] = useState(7);
  const [keepDays, setKeepDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const complete = async () => {
    setBusy(true);
    setError("");
    try {
      const sourceId = selectedSourceId;
      if (!sourceId) throw new Error("Conecte e teste uma origem antes de criar a rotina.");
      let destinationId = selectedDestinationId;
      if (!destinationId) throw new Error("Conecte e teste um armazenamento antes de criar a rotina.");
      const sourceScope = buildSourceScope(sourceType, scopeMode, selectedResource, prefix);
      const schedule = frequency === "manual" ? { type: "manual", timezone: _systemTimezone } : { type: frequency, time: "02:00", timezone: _systemTimezone };
      const policy = await api("/policies", { method: "POST", body: JSON.stringify({ name: routineName, sourceId, destinationId, sourceScope, schedule, retention: { keepLast, keepDays }, options: { compression: "gzip", encryption: false, verifyAfterUpload: true }, enabled: true }) });
      const run = await api(`/policies/${policy.policy.id}/run`, { method: "POST", body: "{}" });
      onDone(run.runId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const availableSources = data.sources.filter((source) => source.type === sourceType && source.status === "healthy");
  useEffect(() => {
    if (!selectedSourceId) {
      setResourceOptions([]);
      setSelectedResource("");
      return;
    }
    setResourceBusy(true);
    api(`/sources/${selectedSourceId}/test`, { method: "POST", body: "{}" }).then((result) => {
      const options = sourceType === "postgres" ? result.resources.databases ?? [] : result.resources.buckets ?? [];
      setResourceOptions(options);
      setSelectedResource((current) => current || options[0] || "");
    }).catch((err) => setError(err.message)).finally(() => setResourceBusy(false));
  }, [selectedSourceId, sourceType]);
  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Novo backup" onClick={onClose}>
      <div className="wizard" onClick={(e) => e.stopPropagation()}>
        <header className="wizardHeader">
          <div><span>Novo backup</span><h2>{stepTitle(step)}</h2></div>
          <button className="iconOnly" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </header>
        <Progress step={step} />
        {step === 1 && (
          <ChoiceGrid>
            <Choice active={sourceType === "postgres"} icon={<Database size={18} />} title="PostgreSQL" text="Escolha um banco ou todos os bancos permitidos." onClick={() => { setSourceType("postgres"); setSelectedSourceId(data.sources.find((source) => source.type === "postgres" && source.status === "healthy")?.id ?? ""); }} />
            <Choice active={sourceType === "minio"} icon={<HardDrive size={18} />} title="MinIO" text="Escolha um bucket ou todos os buckets permitidos." onClick={() => { setSourceType("minio"); setSelectedSourceId(data.sources.find((source) => source.type === "minio" && source.status === "healthy")?.id ?? ""); }} />
            {availableSources.length > 0 && <Field label="Origem pronta"><select value={selectedSourceId} onChange={(e) => setSelectedSourceId(e.target.value)}><option value="">Escolha uma origem</option>{availableSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></Field>}
            {selectedSourceId && <Field label="Escopo desta rotina"><select value={scopeMode} onChange={(e) => setScopeMode(e.target.value as any)}><option value="single">{sourceType === "postgres" ? "Um database" : "Um bucket"}</option><option value="all">{sourceType === "postgres" ? "Todos os databases acessiveis" : "Todos os buckets acessiveis"}</option></select></Field>}
            {selectedSourceId && scopeMode === "single" && <Field label={sourceType === "postgres" ? "Database" : "Bucket"}><select value={selectedResource} onChange={(e) => setSelectedResource(e.target.value)} disabled={resourceBusy}><option value="">{resourceBusy ? "Carregando..." : "Escolha"}</option>{resourceOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>}
            {selectedSourceId && sourceType === "minio" && scopeMode === "single" && <Field label="Prefixo opcional"><input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="ex: uploads/2026" /></Field>}
            {!availableSources.length && <EmptyState compact title="Nenhuma origem pronta" text="Conecte PostgreSQL ou MinIO, liste databases/buckets e rode o teste." />}
            <button className="secondaryButton full" onClick={onCreateSource}><Plus size={15} /> Conectar origem</button>
          </ChoiceGrid>
        )}
        {step === 2 && (
          <ChoiceGrid>
            {healthyDestinations.length > 0 && <div className="choiceSectionTitle">Armazenamentos prontos</div>}
            {healthyDestinations.map((destination) => (
              <Choice key={destination.id} active={selectedDestinationId === destination.id} icon={<Cloud size={18} />} title={destination.name} text={`${destination.type} em ${destination.basePath}`} onClick={() => { setSelectedDestinationId(destination.id); setDestinationType(destination.type === "onedrive" ? "onedrive" : "sharepoint"); }} />
            ))}
            {!healthyDestinations.length && <EmptyState compact title="Nenhum armazenamento pronto" text="Conecte SharePoint ou OneDrive, escolha a biblioteca e rode o teste de permissao." />}
            <button className="secondaryButton full" onClick={onCreateStorage}><Plus size={15} /> Conectar armazenamento</button>
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
            <ReviewRow label="O que proteger" value={sourceScopeLabel(sourceType, buildSourceScope(sourceType, scopeMode, selectedResource, prefix))} />
            <ReviewRow label="Onde salvar" value={selectedDestinationId ? data.destinations.find((item) => item.id === selectedDestinationId)?.name ?? "Armazenamento" : destinationType === "sharepoint" ? "SharePoint" : "OneDrive"} />
            <ReviewRow label="Quando rodar" value={frequency === "daily" ? "Diario, 02:00" : frequency === "weekly" ? "Semanal" : "Manual"} />
            <ReviewRow label="Retencao" value={`manter ${keepLast}; limpar apos ${keepDays} dias`} />
            <ReviewRow label="Primeira execucao" value="Sera iniciada ao concluir" />
          </div>
        )}
        {error && <p className="formError">{error}</p>}
        <footer className="wizardFooter">
          <button className="secondaryButton" onClick={() => step === 1 ? onClose() : setStep(step - 1)}>{step === 1 ? "Cancelar" : <><ChevronLeft size={15} /> Voltar</>}</button>
          {step < 4 ? <button className="primaryButton" disabled={step === 1 && (!selectedSourceId || (scopeMode === "single" && !selectedResource))} onClick={() => setStep(step + 1)}>Continuar</button> : <button className="primaryButton" onClick={complete} disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <Check size={15} />} Criar e executar</button>}
        </footer>
      </div>
    </div>
  );
}

function SourceWizard({ source, onClose, onDone }: { source?: Source; onClose: () => void; onDone: () => void }) {
  const editing = Boolean(source);
  const [type, setType] = useState<SourceType>(source?.type === "minio" ? "minio" : "postgres");
  const [name, setName] = useState(source?.name ?? "PostgreSQL");
  const [host, setHost] = useState(String(source?.config?.host ?? "postgres"));
  const [port, setPort] = useState(String(source?.config?.port ?? 5432));
  const [username, setUsername] = useState(String(source?.config?.username ?? "postgres"));
  const [password, setPassword] = useState("");
  const [endpoint, setEndpoint] = useState(String(source?.config?.endpoint ?? "http://minio:9000"));
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [resources, setResources] = useState<string[]>([]);
  const [draftId, setDraftId] = useState(source?.id ?? "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const buildBody = () => {
    const body: any = type === "postgres"
      ? { name, type, config: { host, port: Number(port), username } }
      : { name, type, config: { endpoint } };
    if (type === "postgres" && password) body.secrets = { password };
    if (type === "minio" && (accessKey || secretKey)) body.secrets = { accessKey, secretKey };
    return body;
  };

  const save = async () => {
    const payload = buildBody();
    if (draftId) return (await api(`/sources/${draftId}`, { method: "PATCH", body: JSON.stringify(payload) })).source;
    const created = (await api("/sources", { method: "POST", body: JSON.stringify(payload) })).source;
    setDraftId(created.id);
    return created;
  };

  const testAndSave = async () => {
    setBusy("test");
    setError("");
    try {
      const saved = await save();
      const result = await api(`/sources/${saved.id}/test`, { method: "POST", body: "{}" });
      const nextResources = type === "postgres" ? result.resources.databases : result.resources.buckets;
      setResources(nextResources);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const saveOnly = async () => {
    setBusy("save");
    setError("");
    try {
      await save();
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label={editing ? "Editar origem" : "Conectar origem"} onClick={onClose}>
      <div className="wizard compactWizard" onClick={(e) => e.stopPropagation()}>
        <header className="wizardHeader"><div><span>Source</span><h2>{editing ? "Editar origem" : "Conectar origem"}</h2></div><button className="iconOnly" onClick={onClose} aria-label="Fechar"><X size={18} /></button></header>
        <ChoiceGrid>
          <Choice active={type === "postgres"} icon={<Database size={18} />} title="PostgreSQL" text="Conexao reutilizavel; databases sao escolhidos na rotina." onClick={() => { setType("postgres"); setName("PostgreSQL"); }} />
          <Choice active={type === "minio"} icon={<HardDrive size={18} />} title="MinIO" text="Conexao reutilizavel; buckets sao escolhidos na rotina." onClick={() => { setType("minio"); setName("MinIO"); }} />
          <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          {type === "postgres" ? <>
            <div className="fieldPair"><Field label="Host"><input value={host} onChange={(e) => setHost(e.target.value)} /></Field><Field label="Porta"><input type="number" value={port} onChange={(e) => setPort(e.target.value)} /></Field></div>
            <Field label="Usuario"><input value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
            <Field label={source ? "Senha nova opcional" : "Senha"}><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          </> : <>
            <Field label="Endpoint"><input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} /></Field>
            <div className="fieldPair"><Field label="Access Key"><input value={accessKey} onChange={(e) => setAccessKey(e.target.value)} /></Field><Field label={source ? "Secret Key nova opcional" : "Secret Key"}><input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} /></Field></div>
          </>}
          {resources.length > 0 && <div className="quotaBox"><strong>{type === "postgres" ? "Databases encontrados" : "Buckets encontrados"}</strong><span>{resources.slice(0, 6).join(", ")}{resources.length > 6 ? ` e mais ${resources.length - 6}` : ""}</span></div>}
        </ChoiceGrid>
        {error && <p className="formError">{error}</p>}
        <footer className="wizardFooter"><button className="secondaryButton" onClick={onClose}>Cancelar</button><div className="footerActions inline"><button className="secondaryButton" disabled={busy === "save"} onClick={saveOnly}>{busy === "save" ? <Loader2 className="spin" size={15} /> : <Check size={15} />} Salvar</button><button className="primaryButton" disabled={busy === "test"} onClick={testAndSave}>{busy === "test" ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />} Testar e listar</button></div></footer>
      </div>
    </div>
  );
}

function StorageWizard({ destination, onClose, onDone }: { destination?: Destination; onClose: () => void; onDone: () => void }) {
  const editing = Boolean(destination);
  const [type, setType] = useState<DestinationType>((destination?.type === "onedrive" ? "onedrive" : "sharepoint"));
  const [name, setName] = useState(destination?.name ?? "SharePoint Backups");
  const [basePath, setBasePath] = useState(destination?.basePath ?? "/SnapVault");
  const [sites, setSites] = useState<MicrosoftSite[]>([]);
  const [drives, setDrives] = useState<MicrosoftDrive[]>([]);
  const [users, setUsers] = useState<MicrosoftUser[]>([]);
  const [integrations, setIntegrations] = useState<MicrosoftIntegration[]>([]);
  const [integrationId, setIntegrationId] = useState(String(destination?.config?.microsoftIntegrationId ?? ""));
  const [siteId, setSiteId] = useState(String(destination?.config?.siteId ?? ""));
  const [driveId, setDriveId] = useState(String(destination?.config?.driveId ?? ""));
  const [userPrincipalName, setUserPrincipalName] = useState(String(destination?.config?.userPrincipalName ?? ""));
  const [advanced, setAdvanced] = useState(false);
  const [testResult, setTestResult] = useState<any>(destination?.metadata ?? null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api("/integrations/microsoft").then((r) => {
      const list = r.integrations ?? [];
      setIntegrations(list);
      if (!integrationId && list[0]) setIntegrationId(list[0].id);
    }).catch((err) => setError(readableGraphError(err.message)));
  }, []);
  useEffect(() => {
    if (!integrationId) return;
    api(`/integrations/microsoft/sites?integrationId=${encodeURIComponent(integrationId)}`).then((r) => setSites(r.sites ?? [])).catch((err) => setError(readableGraphError(err.message)));
    api(`/integrations/microsoft/users?integrationId=${encodeURIComponent(integrationId)}`).then((r) => setUsers(r.users ?? [])).catch(() => setUsers([]));
  }, [integrationId]);
  useEffect(() => {
    if (!siteId || type !== "sharepoint") return;
    api(`/integrations/microsoft/site-drives?siteId=${encodeURIComponent(siteId)}&integrationId=${encodeURIComponent(integrationId)}`).then((r) => setDrives(r.drives ?? [])).catch((err) => setError(readableGraphError(err.message)));
  }, [siteId, type, integrationId]);

  const selectedSite = sites.find((item) => item.id === siteId);
  const selectedDrive = drives.find((item) => item.id === driveId);
  const selectedUser = users.find((item) => item.userPrincipalName === userPrincipalName);

  const buildConfig = () => {
    if (advanced) return { mode: "graph", microsoftIntegrationId: integrationId, driveId };
    if (type === "onedrive") return { mode: "graph", microsoftIntegrationId: integrationId, userPrincipalName, driveId, userName: selectedUser?.displayName ?? userPrincipalName };
    return { mode: "graph", microsoftIntegrationId: integrationId, siteId, siteName: selectedSite?.displayName ?? selectedSite?.name ?? siteId, driveId, driveName: selectedDrive?.name ?? driveId };
  };
  const canTest = Boolean(integrationId) && (advanced ? Boolean(driveId) : type === "onedrive" ? Boolean(userPrincipalName || driveId) : Boolean(siteId && driveId));

  const test = async () => {
    setBusy("test");
    setError("");
    try {
      let probeId = destination?.id;
      if (!probeId) {
        const created = await api("/destinations", { method: "POST", body: JSON.stringify({ name, type, basePath, config: buildConfig(), metadata: { site: selectedSite, drive: selectedDrive, user: selectedUser } }) });
        probeId = created.destination.id;
      } else {
        await api(`/destinations/${probeId}`, { method: "PATCH", body: JSON.stringify({ name, basePath, config: buildConfig(), metadata: { site: selectedSite, drive: selectedDrive, user: selectedUser } }) });
      }
      const result = await api(`/destinations/${probeId}/test`, { method: "POST", body: "{}" });
      setTestResult(result);
      onDone();
    } catch (err: any) {
      setError(readableGraphError(err.message));
    } finally {
      setBusy("");
    }
  };

  const saveOnly = async () => {
    setBusy("save");
    setError("");
    try {
      const payload = { name, type, basePath, config: buildConfig(), metadata: { site: selectedSite, drive: selectedDrive, user: selectedUser } };
      if (destination) await api(`/destinations/${destination.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await api("/destinations", { method: "POST", body: JSON.stringify(payload) });
      onDone();
    } catch (err: any) {
      setError(readableGraphError(err.message));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label={editing ? "Editar armazenamento" : "Conectar armazenamento"} onClick={onClose}>
      <div className="wizard compactWizard" onClick={(e) => e.stopPropagation()}>
        <header className="wizardHeader"><div><span>Storage</span><h2>{editing ? "Editar armazenamento" : "Conectar armazenamento"}</h2></div><button className="iconOnly" onClick={onClose} aria-label="Fechar"><X size={18} /></button></header>
        <ChoiceGrid>
          <Choice active={type === "sharepoint"} icon={<Cloud size={18} />} title="SharePoint" text="Escolha site, biblioteca e pasta." onClick={() => { setType("sharepoint"); setName("SharePoint Backups"); }} />
          <Choice active={type === "onedrive"} icon={<Cloud size={18} />} title="OneDrive" text="Escolha o usuario e a pasta." onClick={() => { setType("onedrive"); setName("OneDrive Backups"); }} />
          <Field label="Integracao Microsoft"><select value={integrationId} onChange={(e) => { setIntegrationId(e.target.value); setSiteId(""); setDriveId(""); }}><option value="">Escolha uma integracao</option>{integrations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          {!advanced && type === "sharepoint" && <Field label="Site SharePoint"><select value={siteId} onChange={(e) => { setSiteId(e.target.value); setDriveId(""); }}><option value="">Escolha um site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.displayName || site.name || site.webUrl || site.id}</option>)}</select></Field>}
          {!advanced && type === "sharepoint" && <Field label="Biblioteca de documentos"><select value={driveId} onChange={(e) => setDriveId(e.target.value)} disabled={!siteId}><option value="">Escolha uma biblioteca</option>{drives.map((drive) => <option key={drive.id} value={drive.id}>{drive.name}</option>)}</select></Field>}
          {!advanced && type === "onedrive" && <Field label="Usuario"><select value={userPrincipalName} onChange={(e) => setUserPrincipalName(e.target.value)}><option value="">Escolha um usuario</option>{users.map((user) => <option key={user.id} value={user.userPrincipalName}>{user.displayName || user.mail || user.userPrincipalName}</option>)}</select></Field>}
          <Field label="Pasta base"><input value={basePath} onChange={(e) => setBasePath(e.target.value)} placeholder="/SnapVault" /></Field>
          <button className="linkButton" onClick={() => setAdvanced(!advanced)}>{advanced ? "Usar fluxo guiado" : "Modo avancado"}</button>
          {advanced && <Field label="Drive ID"><input value={driveId} onChange={(e) => setDriveId(e.target.value)} placeholder="cole o driveId somente se souber o destino exato" /></Field>}
          {testResult?.quota && <div className="quotaBox"><strong>Espaco do drive</strong><span>{formatBytes(testResult.quota.used)} usados de {formatBytes(testResult.quota.total)} · {formatBytes(testResult.quota.remaining)} livres</span></div>}
        </ChoiceGrid>
        {error && <p className="formError">{error}</p>}
        <footer className="wizardFooter"><button className="secondaryButton" onClick={onClose}>Cancelar</button><div className="footerActions inline"><button className="secondaryButton" disabled={busy === "save" || !canTest} onClick={saveOnly}>{busy === "save" ? <Loader2 className="spin" size={15} /> : <Check size={15} />} Salvar sem testar</button><button className="primaryButton" disabled={busy === "test" || !canTest} onClick={test}>{busy === "test" ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />} Testar e salvar</button></div></footer>
      </div>
    </div>
  );
}

function PolicyWizard({ data, policy, onClose, onDone }: { data: AppData; policy: BackupRoutine; onClose: () => void; onDone: () => void }) {
  const initialSource = data.sources.find((item) => item.id === policy.sourceId);
  const initialScope = policySourceScope(policy, initialSource);
  const [name, setName] = useState(policy.name);
  const [sourceId, setSourceId] = useState(policy.sourceId);
  const [destinationId, setDestinationId] = useState(policy.destinationId);
  const [scopeMode, setScopeMode] = useState<"single" | "all">(initialScope.mode);
  const [selectedResource, setSelectedResource] = useState(initialScope.database ?? initialScope.bucket ?? "");
  const [prefix, setPrefix] = useState(initialScope.prefix ?? "");
  const [resourceOptions, setResourceOptions] = useState<string[]>([]);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>((policy.schedule?.type as Frequency) ?? "daily");
  const [time, setTime] = useState(policy.schedule?.time ?? "02:00");
  const [weekday, setWeekday] = useState(Number(policy.schedule?.weekday ?? 0));
  const [keepLast, setKeepLast] = useState(policy.retention?.keepLast ?? 7);
  const [keepDays, setKeepDays] = useState(policy.retention?.keepDays ?? 30);
  const [enabled, setEnabled] = useState(policy.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const healthySources = data.sources.filter((item) => item.status === "healthy" || item.id === policy.sourceId);
  const healthyDestinations = data.destinations.filter((item) => isUsableDestination(item) || item.id === policy.destinationId);
  const selectedSource = data.sources.find((item) => item.id === sourceId);
  useEffect(() => {
    if (!sourceId || !selectedSource) return;
    setResourceBusy(true);
    api(`/sources/${sourceId}/test`, { method: "POST", body: "{}" }).then((result) => {
      const options = selectedSource.type === "postgres" ? result.resources.databases ?? [] : result.resources.buckets ?? [];
      setResourceOptions(options);
      setSelectedResource((current) => current || options[0] || "");
    }).catch((err) => setError(err.message)).finally(() => setResourceBusy(false));
  }, [sourceId]);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const schedule = frequency === "manual" ? { type: "manual", timezone: _systemTimezone } : { type: frequency, time, weekday, timezone: _systemTimezone };
      const sourceScope = buildSourceScope(selectedSource?.type === "minio" ? "minio" : "postgres", scopeMode, selectedResource, prefix);
      await api(`/policies/${policy.id}`, { method: "PATCH", body: JSON.stringify({ name, sourceId, destinationId, sourceScope, schedule, retention: { keepLast, keepDays }, enabled }) });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Editar rotina" onClick={onClose}>
      <div className="wizard compactWizard" onClick={(e) => e.stopPropagation()}>
        <header className="wizardHeader"><div><span>Backup</span><h2>Editar rotina</h2></div><button className="iconOnly" onClick={onClose} aria-label="Fechar"><X size={18} /></button></header>
        <ChoiceGrid>
          <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Conexao"><select value={sourceId} onChange={(e) => { setSourceId(e.target.value); setSelectedResource(""); }}><option value="">Escolha</option>{healthySources.map((item) => <option key={item.id} value={item.id}>{item.name} - {item.type}</option>)}</select></Field>
          {selectedSource && <Field label="O que proteger"><select value={scopeMode} onChange={(e) => setScopeMode(e.target.value as any)}><option value="single">{selectedSource.type === "postgres" ? "Um database" : "Um bucket"}</option><option value="all">{selectedSource.type === "postgres" ? "Todos os databases acessiveis" : "Todos os buckets acessiveis"}</option></select></Field>}
          {selectedSource && scopeMode === "single" && <Field label={selectedSource.type === "postgres" ? "Database" : "Bucket"}><select value={selectedResource} onChange={(e) => setSelectedResource(e.target.value)} disabled={resourceBusy}><option value="">{resourceBusy ? "Carregando..." : "Escolha"}</option>{resourceOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>}
          {selectedSource?.type === "minio" && scopeMode === "single" && <Field label="Prefixo opcional"><input value={prefix} onChange={(e) => setPrefix(e.target.value)} /></Field>}
          <Field label="Onde salvar"><select value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>{healthyDestinations.map((item) => <option key={item.id} value={item.id}>{item.name} - {item.basePath}</option>)}</select></Field>
          <Field label="Frequencia"><select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}><option value="manual">Manual</option><option value="daily">Diario</option><option value="weekly">Semanal</option></select></Field>
          {frequency !== "manual" && <div className="fieldPair"><Field label="Horario UTC"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field><Field label="Dia semanal"><select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} disabled={frequency !== "weekly"}><option value={0}>Domingo</option><option value={1}>Segunda</option><option value={2}>Terca</option><option value={3}>Quarta</option><option value={4}>Quinta</option><option value={5}>Sexta</option><option value={6}>Sabado</option></select></Field></div>}
          <div className="fieldPair"><Field label="Manter no minimo"><input type="number" min={1} value={keepLast} onChange={(e) => setKeepLast(Math.max(1, Number(e.target.value)))} /></Field><Field label="Apagar apos dias"><input type="number" min={0} value={keepDays} onChange={(e) => setKeepDays(Math.max(0, Number(e.target.value)))} /></Field></div>
          <Field label="Estado"><select value={enabled ? "enabled" : "paused"} onChange={(e) => setEnabled(e.target.value === "enabled")}><option value="enabled">Ativa</option><option value="paused">Pausada</option></select></Field>
        </ChoiceGrid>
        {error && <p className="formError">{error}</p>}
        <footer className="wizardFooter"><button className="secondaryButton" onClick={onClose}>Cancelar</button><button className="primaryButton" disabled={busy} onClick={save}>{busy ? <Loader2 className="spin" size={15} /> : <Check size={15} />} Salvar</button></footer>
      </div>
    </div>
  );
}

function RestoreExecuteModal({ data, request, onClose, onDone }: { data: AppData; request: RestoreRequest; onClose: () => void; onDone: () => void }) {
  const targets = data.sources.filter((source) => source.type === request.sourceType && source.status === "healthy");
  const [targetSourceId, setTargetSourceId] = useState(targets[0]?.id ?? "");
  const [targetResource, setTargetResource] = useState("");
  const [targetPrefix, setTargetPrefix] = useState("");
  const [resourceOptions, setResourceOptions] = useState<string[]>([]);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const targetSource = data.sources.find((source) => source.id === targetSourceId);
  useEffect(() => {
    if (!targetSourceId || !targetSource) return;
    setResourceBusy(true);
    api(`/sources/${targetSourceId}/test`, { method: "POST", body: "{}" }).then((result) => {
      const options = targetSource.type === "postgres" ? result.resources.databases ?? [] : result.resources.buckets ?? [];
      setResourceOptions(options);
      setTargetResource((current) => current || options[0] || "");
    }).catch((err) => setError(err.message)).finally(() => setResourceBusy(false));
  }, [targetSourceId]);
  const execute = async () => {
    setBusy(true);
    setError("");
    try {
      const targetScope = targetSource?.type === "minio" ? { mode: "single", bucket: targetResource, prefix: targetPrefix } : { mode: "single", database: targetResource };
      await api("/restores/execute", { method: "POST", body: JSON.stringify({ artifactId: request.artifact.id, targetSourceId, targetScope }) });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Executar restore" onClick={onClose}>
      <div className="wizard compactWizard" onClick={(e) => e.stopPropagation()}>
        <header className="wizardHeader"><div><span>Restore</span><h2>Recuperar backup</h2></div><button className="iconOnly" onClick={onClose} aria-label="Fechar"><X size={18} /></button></header>
        <div className="reviewBox">
          <ReviewRow label="Execucao" value={request.runId} />
          <ReviewRow label="Artefato" value={request.artifact.path.split(/[\\/]/).pop() ?? request.artifact.kind} />
          <ReviewRow label="Tamanho" value={formatBytes(request.artifact.sizeBytes)} />
        </div>
        {!targets.length ? <EmptyState compact title="Sem destino compativel" text="Crie e teste uma origem saudavel do mesmo tipo para executar restore." /> : <ChoiceGrid><Field label="Conexao alvo"><select value={targetSourceId} onChange={(e) => { setTargetSourceId(e.target.value); setTargetResource(""); }}>{targets.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></Field><Field label={targetSource?.type === "minio" ? "Bucket alvo" : "Database alvo"}><select value={targetResource} onChange={(e) => setTargetResource(e.target.value)} disabled={resourceBusy}><option value="">{resourceBusy ? "Carregando..." : "Escolha"}</option>{resourceOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>{targetSource?.type === "minio" && <Field label="Prefixo alvo opcional"><input value={targetPrefix} onChange={(e) => setTargetPrefix(e.target.value)} /></Field>}</ChoiceGrid>}
        {error && <p className="formError">{error}</p>}
        <footer className="wizardFooter"><button className="secondaryButton" onClick={onClose}>Cancelar</button><button className="primaryButton" disabled={busy || !targetSourceId || !targetResource} onClick={execute}>{busy ? <Loader2 className="spin" size={15} /> : <RotateCcw size={15} />} Executar restore</button></footer>
      </div>
    </div>
  );
}

function RunDetail({ runId }: { runId: string }) {
  const [detail, setDetail] = useState<RunDetailData | null>(null);
  const [error, setError] = useState("");
  const logBoxRef = useRef<HTMLDivElement>(null);
  const isActive = detail?.run.status === "queued" || detail?.run.status === "running";

  const load = (setNull: boolean) => {
    let active = true;
    if (setNull) { setDetail(null); setError(""); }
    api(`/runs/${runId}`).then((d) => { if (active) setDetail(d); }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  };

  useEffect(() => load(true), [runId]);

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => load(false), 2500);
    return () => clearInterval(timer);
  }, [runId, isActive]);

  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [detail?.logs.length]);
  if (!detail && !error) return <div className="loading mini"><Loader2 className="spin" size={18} /> Carregando</div>;
  if (error) return <p className="formError">{error}</p>;
  if (!detail) return null;
  return (
    <div className="detailBody">
      <ReviewRow label="Status" value={statusLabel(detail.run.status)} />
      <ReviewRow label="Integridade" value={verificationLabel(detail.run)} />
      <ReviewRow label="Criado em" value={formatDate(detail.run.createdAt)} />
      <ReviewRow label="Tamanho" value={formatBytes(detail.run.bytesWritten)} />
      <SectionHeader title="Arquivos" />
      {!detail.artifacts.filter((a) => a.kind !== "manifest").length
        ? <EmptyState compact title="Sem arquivos" text="A execucao ainda nao gerou artefatos." />
        : detail.artifacts.filter((a) => a.kind !== "manifest").map((artifact) => (
            <div className="artifactRow" key={artifact.id}>
              <FileArchive size={16} />
              <div>
                <strong>{artifact.kind === "postgres_dump" ? "Dump PostgreSQL" : artifact.kind === "minio_snapshot" ? "Snapshot MinIO" : artifact.path.split(/[\\/]/).pop() ?? artifact.kind}</strong>
                <span>{formatBytes(artifact.sizeBytes)}</span>
                <span className="artifactPath">{artifact.path}</span>
              </div>
            </div>
          ))
      }
      <SectionHeader title="Logs" action={
        <div className="rowActions">
          {isActive && <span className="liveBadge"><span className="liveDot" />ao vivo</span>}
          {detail.logs.length > 0 && (
            <button className="iconOnly" title="Copiar logs" onClick={() => {
              const text = detail.logs.map((l) => `${formatDate(l.createdAt)} ${l.level}: ${l.message}${l.data?.error ? ` - ${l.data.error}` : ""}`).join("\n");
              navigator.clipboard.writeText(text);
            }}><Copy size={14} /></button>
          )}
        </div>
      } />
      <div className="logBox" ref={logBoxRef}>
        {detail.run.errorMessage && <code className="log-error">{formatDate(detail.run.finishedAt ?? detail.run.createdAt)} error: {detail.run.errorMessage}</code>}
        {detail.logs.length
          ? detail.logs.map((log, index) => <code key={index} className={`log-${log.level}`}>{formatDate(log.createdAt)} {log.level}: {log.message}{log.data?.error ? ` - ${log.data.error}` : ""}</code>)
          : <code>Sem logs registrados.</code>
        }
      </div>
    </div>
  );
}

function RunDetailModal({ runId, onClose }: { runId: string; onClose: () => void }) {
  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Detalhes da execucao" onClick={onClose}>
      <div className="wizard compactWizard" onClick={(e) => e.stopPropagation()}>
        <header className="wizardHeader">
          <div><span>Historico</span><h2>Execucao</h2></div>
          <button className="iconOnly" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </header>
        <RunDetail runId={runId} />
      </div>
    </div>
  );
}

function AuthMode({ mode, error, setError, onDone }: { mode: "setup" | "login"; error: string; setError: (value: string) => void; onDone: (user: any) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        {mode === "setup" && <p>Configure o administrador inicial do SnapVault para comecar a proteger seus dados.</p>}
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

function BackupList({ data, onRun, onPolicyOpen, onEdit, busy, limit, onToggle, onDelete }: { data: AppData; onRun: (id: string) => void; onPolicyOpen: (id: string) => void; onEdit?: (policy: BackupRoutine) => void; busy: string; limit?: number; onToggle?: (policy: BackupRoutine) => void; onDelete?: (id: string) => void }) {
  const items = limit ? data.policies.slice(0, limit) : data.policies;
  if (!items.length) return <EmptyState title="Nenhum backup automatico" text="Crie seu primeiro backup para proteger PostgreSQL ou MinIO." />;
  return (
    <div className="itemList">
      {items.map((policy) => {
        const source = data.sources.find((item) => item.id === policy.sourceId);
        const destination = data.destinations.find((item) => item.id === policy.destinationId);
        const lastRun = data.runs.find((run) => run.policyId === policy.id);
        const scope = source ? sourceScopeLabel(source.type as SourceType, policySourceScope(policy, source)) : "origem";
        return (
          <article className="listItem" key={policy.id}>
            <button className="itemMain itemButton" onClick={() => onPolicyOpen(policy.id)}>
              <strong>{policy.name}</strong>
              <span>{scope} para {destination?.type ?? "armazenamento"} · {policy.enabled ? "ativo" : "pausado"}</span>
            </button>
            <StatusBadge status={policy.enabled ? lastRun?.status ?? "ready" : "paused"} />
            <div className="rowActions">
              <button className="secondaryButton small" disabled={busy === policy.id} onClick={() => onRun(policy.id)}>{busy === policy.id ? <Loader2 className="spin" size={14} /> : <Play size={14} />} Rodar</button>
              {onEdit && <button className="secondaryButton small" disabled={busy === policy.id} onClick={() => onEdit(policy)}><Pencil size={14} /> Editar</button>}
              {onToggle && <button className="secondaryButton small" disabled={busy === policy.id} onClick={() => onToggle(policy)}>{policy.enabled ? <Pause size={14} /> : <Play size={14} />} {policy.enabled ? "Pausar" : "Ativar"}</button>}
              {onDelete && <button className="iconOnly danger" disabled={busy === policy.id} onClick={() => onDelete(policy.id)} aria-label="Remover backup"><Trash2 size={15} /></button>}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function StorageList({ destinations, dependencyCount, onTest, onEdit, onArchive, onDelete, busy }: { destinations: Destination[]; dependencyCount: (id: string) => number; onTest: (id: string) => void; onEdit: (destination: Destination) => void; onArchive: (destination: Destination) => void; onDelete: (destination: Destination) => void; busy: string }) {
  if (!destinations.length) return <EmptyState title="Nenhum armazenamento" text="Conecte SharePoint ou OneDrive para salvar seus backups." />;
  return <div className="itemList">{destinations.map((destination) => {
    const deps = dependencyCount(destination.id);
    const quota = destination.metadata?.quota;
    const place = destination.config?.siteName || destination.config?.userName || destination.config?.userPrincipalName || destination.type;
    const library = destination.config?.driveName ? ` · ${destination.config.driveName}` : "";
    return (
      <article className="listItem storageItem" key={destination.id}>
        <div className="itemMain">
          <strong>{destination.name}</strong>
          <span>{place}{library} · {destination.basePath}</span>
          {quota && <span>{formatBytes(quota.used)} usados · {formatBytes(quota.remaining)} livres</span>}
        </div>
        <StatusBadge status={destination.status} />
        <div className="rowActions">
          <button className="secondaryButton small" disabled={busy === destination.id || destination.status === "archived"} onClick={() => onTest(destination.id)}>{busy === destination.id ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />} Testar</button>
          <button className="secondaryButton small" disabled={busy === destination.id} onClick={() => onEdit(destination)}><Pencil size={14} /> Editar</button>
          <button className="secondaryButton small" disabled={busy === destination.id} onClick={() => destination.status === "archived" ? onArchive(destination) : deps > 0 ? onArchive(destination) : onDelete(destination)}>{destination.status === "archived" ? <RefreshCw size={14} /> : <Trash2 size={14} />} {destination.status === "archived" ? "Reativar" : deps > 0 ? "Arquivar" : "Excluir"}</button>
        </div>
      </article>
    );
  })}</div>;
}

function RecentRuns({ runs }: { runs: Run[] }) {
  const [openRunId, setOpenRunId] = useState("");
  return (
    <section className="card">
      <SectionHeader title="Execucoes recentes" />
      {!runs.length
        ? <EmptyState title="Sem historico" text="As execucoes aparecem aqui depois do primeiro backup." compact />
        : <div className="runList">
            {runs.slice(0, 4).map((run) => (
              <div key={run.id}>
                <button className={`runItem${openRunId === run.id ? " active" : ""}`} onClick={() => setOpenRunId(openRunId === run.id ? "" : run.id)}>
                  <StatusBadge status={run.status} />
                  <code>{formatDate(run.createdAt)}</code>
                  <span>{formatBytes(run.bytesWritten)}</span>
                </button>
                {openRunId === run.id && (
                  <div className="runItemDetail">
                    <RunDetail runId={run.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
      }
    </section>
  );
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
  const labels: Record<string, string> = {
    success: "enviado",
    verified: "verificado",
    recoverable: "restore testado",
    restore_failed: "restore falhou",
    failed: "falhou",
    healthy: "conectado",
    ready: "pronto",
    untested: "nao testado",
    paused: "pausado",
    archived: "arquivado",
    running: "em progresso",
    queued: "na fila",
  };
  return labels[status] ?? status;
}

function verificationLabel(run: Run) {
  if (run.status === "recoverable" || run.verificationStatus === "restore_verified") return "restore testado";
  if (run.status === "verified" || run.verificationStatus === "integrity_verified") return "checksum e estrutura ok";
  return "nao verificado";
}

function tzAbbr(timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, timeZoneName: "short" })
    .formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? timezone;
}

function scheduleLabel(policy: BackupRoutine) {
  const type = policy.schedule?.type;
  const time = policy.schedule?.time ?? "02:00";
  const tz = policy.schedule?.timezone ?? _systemTimezone;
  const abbr = tzAbbr(tz);
  if (type === "weekly") return `semanal, ${time} ${abbr}`;
  if (type === "daily") return `diario, ${time} ${abbr}`;
  return "manual";
}

function buildSourceScope(sourceType: SourceType, mode: "single" | "all", resource: string, prefix = ""): SourceScope {
  if (sourceType === "postgres") return mode === "all" ? { mode } : { mode, database: resource };
  return mode === "all" ? { mode } : { mode, bucket: resource, prefix };
}

function policySourceScope(policy: BackupRoutine, source?: Source): SourceScope {
  if (policy.sourceScope?.mode) return policy.sourceScope;
  if (source?.type === "postgres") return { mode: source.config?.scope === "all" ? "all" : "single", database: source.config?.database ?? "" };
  return { mode: source?.config?.scope === "all" ? "all" : "single", bucket: source?.config?.bucket ?? "", prefix: source?.config?.prefix ?? "" };
}

function sourceScopeLabel(sourceType: SourceType, scope: SourceScope) {
  if (scope.mode === "all") return sourceType === "postgres" ? "Todos os databases" : "Todos os buckets";
  if (sourceType === "postgres") return `Database ${scope.database || "-"}`;
  return `Bucket ${scope.bucket || "-"}${scope.prefix ? `/${scope.prefix}` : ""}`;
}

function isUsableDestination(destination: Destination) {
  if (destination.status !== "healthy") return false;
  if ((destination.type === "onedrive" || destination.type === "sharepoint") && destination.config?.mode === "graph") {
    return Boolean(destination.config.driveId || destination.config.userPrincipalName || destination.config.siteId || (destination.config.hostname && destination.config.sitePath));
  }
  return true;
}

function retentionLabel(policy: BackupRoutine) {
  const keepLast = policy.retention?.keepLast ?? 7;
  const keepDays = policy.retention?.keepDays ?? 30;
  return `manter ${keepLast}; limpar apos ${keepDays} dias`;
}

function formatBytes(value: number | null) {
  if (value === null || value === undefined) return "—";
  if (value === 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

let _systemTimezone = "America/Sao_Paulo";
export function setSystemTimezone(tz: string) { _systemTimezone = tz; }

function formatDate(value: string, timezone?: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: timezone ?? _systemTimezone }).format(new Date(value));
}

function readableGraphError(message: string) {
  if (message.includes("Microsoft credentials are not configured")) return "Configure Tenant ID, Client ID e Client Secret em Settings antes de conectar Storage.";
  if (message.includes("403") || message.toLowerCase().includes("proibido")) return "Permissao insuficiente no Microsoft Graph para esse site ou biblioteca.";
  if (message.includes("404")) return "Site, biblioteca ou pasta nao encontrada pelo Microsoft Graph.";
  if (message.toLowerCase().includes("delete")) return "O teste criou e leu o arquivo, mas nao conseguiu excluir. Revise permissoes de escrita/exclusao.";
  return message;
}

createRoot(document.getElementById("root")!).render(<App />);
