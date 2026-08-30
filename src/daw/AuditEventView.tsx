import { Clock3 } from "lucide-react";
import type { AuditEvent } from "./model";

export default function AuditEventView({ events }: { events: AuditEvent[] }) {
  return (
    <section aria-label="Project audit events" className="h-full flex flex-col">
      <div className="h-10 border-b border-neutral-800 flex items-center px-3"><h2 className="text-xs font-semibold uppercase tracking-wider">Project events</h2><span className="ml-auto text-[10px] text-neutral-500">This session · newest first</span></div>
      <ol className="flex-1 overflow-auto p-3 space-y-2">
        {events.length === 0 && <li data-testid="status-empty-audit" className="text-xs text-neutral-500">No project events yet.</li>}
        {events.map((event) => <li data-testid={`event-audit-${event.id}`} key={event.id} className="border-l-2 border-orange-500/50 pl-3 py-1">
          <div className="flex items-center gap-2"><span className="text-[10px] uppercase text-orange-400">{event.type}</span><time className="text-[9px] text-neutral-600 flex items-center gap-1"><Clock3 className="w-2.5 h-2.5" />{new Date(event.at).toLocaleTimeString()}</time></div>
          <p className="text-xs mt-1">{event.summary}</p>{event.metadata && <p className="text-[10px] text-neutral-500">{Object.entries(event.metadata).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}</p>}
        </li>)}
      </ol>
    </section>
  );
}