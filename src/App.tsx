import {
  ArrowDownUp,
  ExternalLink,
  FolderSearch,
  Hammer,
  LoaderCircle,
  Package,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Terminal
} from "lucide-react";
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";

type PackageStatus = "healthy" | "attention" | "minimal";

type PackageSummary = {
  id: string;
  name: string;
  version: string;
  packageManager: string;
  relativePath: string;
  absolutePath: string;
  rootPath: string;
  private: boolean;
  dependencyCount: number;
  devDependencyCount: number;
  scriptCount: number;
  workspaceCount: number;
  lastModified: string;
  status: PackageStatus;
  statusReason: string;
  scriptNames: string[];
};

type PackageDetail = PackageSummary & {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  engines: Record<string, string>;
  keywords: string[];
  workspaces: string[];
  description: string;
};

type RootPayload = {
  roots: string[];
  suggestions: string[];
};

type MetaPayload = {
  application: string;
  logFilePath: string;
  stats: {
    packageCount: number;
    healthyCount: number;
    attentionCount: number;
    minimalCount: number;
  };
};

type ActionPayload = {
  packageId: string;
  packageName: string;
  result: {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    startedAt: string;
    endedAt: string;
  };
};

const fetchJson = async <T,>(input: string, init?: RequestInit) => {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorPayload?.message ?? "Unexpected API response");
  }

  return (await response.json()) as T;
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

const statusLabel: Record<PackageStatus, string> = {
  healthy: "Ready",
  attention: "Needs polish",
  minimal: "Barebones"
};

const App = () => {
  const [rootsPayload, setRootsPayload] = useState<RootPayload>({ roots: [], suggestions: [] });
  const [packages, setPackages] = useState<PackageSummary[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<PackageDetail | null>(null);
  const [meta, setMeta] = useState<MetaPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMutatingRoots, setIsMutatingRoots] = useState(false);
  const [isRunningAction, setIsRunningAction] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionOutput, setActionOutput] = useState<ActionPayload | null>(null);
  const [newRoot, setNewRoot] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<PackageStatus | "all">("all");

  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const reloadRoots = async () => {
    setRootsPayload(await fetchJson<RootPayload>("/api/roots"));
  };

  const reloadMeta = async () => {
    setMeta(await fetchJson<MetaPayload>("/api/meta"));
  };

  const reloadPackages = async (refresh = false) => {
    const packagePayload = await fetchJson<{ packages: PackageSummary[] }>(
      `/api/packages${refresh ? "?refresh=1" : ""}`
    );

    startTransition(() => {
      setPackages(packagePayload.packages);
      setSelectedPackageId((currentId) =>
        currentId && packagePayload.packages.some((entry) => entry.id === currentId)
          ? currentId
          : packagePayload.packages[0]?.id ?? null
      );
    });
  };

  const loadDashboard = async (refresh = false) => {
    setErrorMessage(null);

    try {
      await Promise.all([reloadRoots(), reloadPackages(refresh), reloadMeta()]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load dashboard");
    }
  };

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        await Promise.all([reloadRoots(), reloadPackages(), reloadMeta()]);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to load dashboard");
      }

      setIsLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!selectedPackageId) {
      setSelectedPackage(null);
      return;
    }

    void (async () => {
      try {
        const payload = await fetchJson<{ package: PackageDetail }>(`/api/packages/${selectedPackageId}`);
        setSelectedPackage(payload.package);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to load package detail");
      }
    })();
  }, [selectedPackageId]);

  const visiblePackages = useMemo(() => {
    return packages.filter((entry) => {
      const matchesStatus = statusFilter === "all" || entry.status === statusFilter;
      const matchesQuery =
        deferredQuery.length === 0 ||
        [entry.name, entry.relativePath, entry.packageManager, ...entry.scriptNames]
          .join(" ")
          .toLowerCase()
          .includes(deferredQuery);

      return matchesStatus && matchesQuery;
    });
  }, [deferredQuery, packages, statusFilter]);

  const selectedPackageSummary = selectedPackage ?? packages.find((entry) => entry.id === selectedPackageId) ?? null;

  const saveRoots = async (roots: string[]) => {
    setIsMutatingRoots(true);
    setErrorMessage(null);

    try {
      await fetchJson<{ roots: string[] }>("/api/roots", {
        method: "POST",
        body: JSON.stringify({ roots })
      });

      setNewRoot("");
      await loadDashboard(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to save roots");
    } finally {
      setIsMutatingRoots(false);
    }
  };

  const addRoot = async (rootPath: string) => {
    const trimmedRoot = rootPath.trim();
    if (!trimmedRoot) {
      return;
    }

    await saveRoots([...rootsPayload.roots, trimmedRoot]);
  };

  const removeRoot = async (rootPath: string) => {
    const nextRoots = rootsPayload.roots.filter((entry) => entry !== rootPath);
    if (nextRoots.length === 0) {
      return;
    }

    await saveRoots(nextRoots);
  };

  const refreshDashboard = async () => {
    setIsRefreshing(true);
    await loadDashboard(true);
    setIsRefreshing(false);
  };

  const triggerAction = async (
    payload: { type: "install" } | { type: "open-folder" } | { type: "script"; scriptName: string }
  ) => {
    if (!selectedPackageSummary) {
      return;
    }

    setIsRunningAction(true);
    setErrorMessage(null);

    try {
      const actionPayload = await fetchJson<ActionPayload>(`/api/packages/${selectedPackageSummary.id}/actions`, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      setActionOutput(actionPayload);
      await loadDashboard(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to run action");
    } finally {
      setIsRunningAction(false);
    }
  };

  if (isLoading) {
    return (
      <main className="shell shell--loading">
        <LoaderCircle className="spinner" />
        <p>Loading local package workspace...</p>
      </main>
    );
  }

  return (
    <main className="shell">
      <aside className="rail panel">
        <div className="brand">
          <div>
            <p className="eyebrow">Technical editorial minimal</p>
            <h1>Xnpm</h1>
          </div>
          <span className="pill pill--contrast">Local-first</span>
        </div>

        <p className="lede">
          Discover, inspect and operate Node packages on your machine without leaving a clean control room.
        </p>

        {meta ? (
          <section className="stat-grid">
            <article className="stat-card">
              <span>Packages</span>
              <strong>{meta.stats.packageCount}</strong>
            </article>
            <article className="stat-card">
              <span>Ready</span>
              <strong>{meta.stats.healthyCount}</strong>
            </article>
            <article className="stat-card">
              <span>Needs work</span>
              <strong>{meta.stats.attentionCount}</strong>
            </article>
            <article className="stat-card">
              <span>Barebones</span>
              <strong>{meta.stats.minimalCount}</strong>
            </article>
          </section>
        ) : null}

        <section className="section-block">
          <div className="section-heading">
            <h2>Scan roots</h2>
            <button
              className="icon-button"
              disabled={isRefreshing}
              onClick={() => {
                void refreshDashboard();
              }}
              type="button"
            >
              <RefreshCw className={isRefreshing ? "spinning-icon" : ""} size={16} />
            </button>
          </div>

          <div className="root-form">
            <input
              onChange={(event) => {
                setNewRoot(event.target.value);
              }}
              placeholder="Add folder path, for example C:\Dev"
              value={newRoot}
            />
            <button
              className="primary-button"
              disabled={isMutatingRoots}
              onClick={() => {
                void addRoot(newRoot);
              }}
              type="button"
            >
              <FolderSearch size={16} />
              Add root
            </button>
          </div>

          <div className="chip-list">
            {rootsPayload.suggestions
              .filter((entry) => !rootsPayload.roots.includes(entry))
              .map((suggestion) => (
                <button
                  className="chip"
                  key={suggestion}
                  onClick={() => {
                    void addRoot(suggestion);
                  }}
                  type="button"
                >
                  {suggestion}
                </button>
              ))}
          </div>

          <div className="root-list">
            {rootsPayload.roots.map((rootPath) => (
              <article className="root-item" key={rootPath}>
                <div>
                  <strong>{rootPath}</strong>
                  <span>Active scan source</span>
                </div>
                <button
                  className="ghost-button"
                  disabled={rootsPayload.roots.length === 1 || isMutatingRoots}
                  onClick={() => {
                    void removeRoot(rootPath);
                  }}
                  type="button"
                >
                  Remove
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="section-block">
          <div className="section-heading">
            <h2>Runtime</h2>
            <ShieldAlert size={16} />
          </div>
          <p className="mini-copy">
            Action traces are written to <code>{meta?.logFilePath ?? "logs/xnpm-dev.log"}</code>.
          </p>
        </section>
      </aside>

      <section className="catalog panel">
        <div className="catalog-toolbar">
          <label className="search-field">
            <Search size={16} />
            <input
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search by name, path or script"
              value={query}
            />
          </label>

          <label className="select-field">
            <ArrowDownUp size={16} />
            <select
              onChange={(event) => {
                setStatusFilter(event.target.value as PackageStatus | "all");
              }}
              value={statusFilter}
            >
              <option value="all">All statuses</option>
              <option value="healthy">Ready</option>
              <option value="attention">Needs polish</option>
              <option value="minimal">Barebones</option>
            </select>
          </label>
        </div>

        <div className="catalog-header">
          <div>
            <p className="eyebrow">Differentiation anchor</p>
            <h2>Package ledger</h2>
          </div>
          <p className="mini-copy">
            A border-led ledger instead of a generic SaaS table keeps the workspace memorable without adding noise.
          </p>
        </div>

        <div className="package-list">
          {visiblePackages.map((entry) => (
            <button
              className={`package-card ${selectedPackageId === entry.id ? "package-card--active" : ""}`}
              key={entry.id}
              onClick={() => {
                setSelectedPackageId(entry.id);
              }}
              type="button"
            >
              <div className="package-card__heading">
                <div>
                  <strong>{entry.name}</strong>
                  <span>{entry.relativePath}</span>
                </div>
                <span className={`pill pill--${entry.status}`}>{statusLabel[entry.status]}</span>
              </div>

              <p className="package-card__reason">{entry.statusReason}</p>

              <div className="metric-row">
                <span>{entry.packageManager}</span>
                <span>{entry.version}</span>
                <span>{entry.scriptCount} scripts</span>
                <span>{entry.dependencyCount + entry.devDependencyCount} deps</span>
              </div>
            </button>
          ))}

          {visiblePackages.length === 0 ? (
            <article className="empty-state">
              <Package size={18} />
              <div>
                <strong>No packages match this view</strong>
                <p>Adjust your filter or add another scan root.</p>
              </div>
            </article>
          ) : null}
        </div>
      </section>

      <aside className="detail panel">
        {selectedPackageSummary ? (
          <>
            <div className="detail-header">
              <div>
                <p className="eyebrow">Selected package</p>
                <h2>{selectedPackageSummary.name}</h2>
              </div>
              <span className={`pill pill--${selectedPackageSummary.status}`}>
                {statusLabel[selectedPackageSummary.status]}
              </span>
            </div>

            <p className="detail-path">{selectedPackageSummary.absolutePath}</p>
            <p className="detail-description">{selectedPackage?.description || selectedPackageSummary.statusReason}</p>

            <div className="action-grid">
              <button
                className="primary-button"
                disabled={isRunningAction}
                onClick={() => {
                  void triggerAction({ type: "install" });
                }}
                type="button"
              >
                <Sparkles size={16} />
                Install
              </button>
              <button
                className="ghost-button"
                disabled={isRunningAction || !selectedPackage?.scripts.lint}
                onClick={() => {
                  void triggerAction({ type: "script", scriptName: "lint" });
                }}
                type="button"
              >
                <ShieldAlert size={16} />
                Lint
              </button>
              <button
                className="ghost-button"
                disabled={isRunningAction || !selectedPackage?.scripts.test}
                onClick={() => {
                  void triggerAction({ type: "script", scriptName: "test" });
                }}
                type="button"
              >
                <Hammer size={16} />
                Test
              </button>
              <button
                className="ghost-button"
                disabled={isRunningAction || !selectedPackage?.scripts.build}
                onClick={() => {
                  void triggerAction({ type: "script", scriptName: "build" });
                }}
                type="button"
              >
                <Terminal size={16} />
                Build
              </button>
              <button
                className="ghost-button"
                disabled={isRunningAction}
                onClick={() => {
                  void triggerAction({ type: "open-folder" });
                }}
                type="button"
              >
                <ExternalLink size={16} />
                Open folder
              </button>
            </div>

            <section className="detail-section">
              <div className="section-heading">
                <h3>Scripts</h3>
                <span>{selectedPackageSummary.scriptCount}</span>
              </div>
              <div className="script-list">
                {selectedPackage?.scriptNames.map((scriptName) => (
                  <button
                    className="script-item"
                    key={scriptName}
                    onClick={() => {
                      void triggerAction({ type: "script", scriptName });
                    }}
                    type="button"
                  >
                    <div>
                      <strong>{scriptName}</strong>
                      <span>{selectedPackage?.scripts[scriptName]}</span>
                    </div>
                    <Terminal size={14} />
                  </button>
                ))}
              </div>
            </section>

            <section className="detail-section">
              <div className="section-heading">
                <h3>Dependencies</h3>
                <span>{selectedPackageSummary.dependencyCount + selectedPackageSummary.devDependencyCount}</span>
              </div>
              <div className="dependency-groups">
                <article>
                  <strong>Runtime</strong>
                  <ul>
                    {Object.entries(selectedPackage?.dependencies ?? {}).slice(0, 6).map(([key, value]) => (
                      <li key={key}>
                        <span>{key}</span>
                        <code>{value}</code>
                      </li>
                    ))}
                  </ul>
                </article>
                <article>
                  <strong>Development</strong>
                  <ul>
                    {Object.entries(selectedPackage?.devDependencies ?? {}).slice(0, 6).map(([key, value]) => (
                      <li key={key}>
                        <span>{key}</span>
                        <code>{value}</code>
                      </li>
                    ))}
                  </ul>
                </article>
              </div>
            </section>

            <section className="detail-section console-section">
              <div className="section-heading">
                <h3>Action console</h3>
                {isRunningAction ? <LoaderCircle className="spinning-icon" size={16} /> : null}
              </div>

              {actionOutput ? (
                <div className="console-output">
                  <p>
                    <strong>{actionOutput.packageName}</strong> · <code>{actionOutput.result.command}</code>
                  </p>
                  <p className={actionOutput.result.exitCode === 0 ? "console-ok" : "console-error"}>
                    Exit code {actionOutput.result.exitCode} · finished {formatDate(actionOutput.result.endedAt)}
                  </p>
                  <pre>{actionOutput.result.stdout || actionOutput.result.stderr || "Command completed without output."}</pre>
                </div>
              ) : (
                <p className="mini-copy">Run an install, lint, test, build or custom script to inspect live output here.</p>
              )}
            </section>
          </>
        ) : (
          <div className="empty-state empty-state--detail">
            <Package size={20} />
            <div>
              <strong>Select a package</strong>
              <p>Pick an entry from the ledger to inspect scripts, dependencies and development actions.</p>
            </div>
          </div>
        )}

        {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
      </aside>
    </main>
  );
};

export default App;
