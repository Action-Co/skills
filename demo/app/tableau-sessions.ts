// Reuse a live Tableau session, but replace cached entries after a tab or bridge disappears.
export type TableauSession = { session: string; tabUrl: string };
type Demo = { id: string; url: string; script?: string };
type Run = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export function createTableauSessionLoader(shown: Map<string, TableauSession>, run: Run) {
  const pending = new Map<string, Promise<TableauSession>>();

  async function load(demo: Demo, replay: boolean): Promise<TableauSession> {
    const existing = shown.get(demo.id);
    if (existing && !replay) {
      try {
        const status = await run(["status", "--session", existing.session, "-f", "json"]);
        if (status.code === 0 && ["interactive", "loading", "connecting", "auth"].includes(JSON.parse(status.stdout).state)) {
          return existing;
        }
      } catch {
        // A missing registry entry, dead bridge, or invalid reply needs a new session.
      }
    }
    shown.delete(demo.id);
    const args = ["start", "--url", demo.url, "--no-open", "-f", "json"];
    if (demo.script) args.push("--script", demo.script);
    const started = await run(args);
    if (started.code !== 0) throw new Error(started.stderr.trim().split("\n").pop() || "Tableau could not open the dashboard.");
    const entry = JSON.parse(started.stdout) as TableauSession;
    if (typeof entry.session !== "string" || !entry.session || typeof entry.tabUrl !== "string" || !entry.tabUrl) {
      throw new Error("Tableau did not return a usable dashboard session.");
    }
    const session = { session: entry.session, tabUrl: entry.tabUrl };
    shown.set(demo.id, session);
    return session;
  }

  return (demo: Demo, replay = false): Promise<TableauSession> => {
    const existing = pending.get(demo.id);
    if (existing) return existing;
    const job = load(demo, replay).finally(() => pending.delete(demo.id));
    pending.set(demo.id, job);
    return job;
  };
}
