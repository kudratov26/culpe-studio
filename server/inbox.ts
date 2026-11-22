// Delivery to agents. With one-shot OpenCode runs there is no terminal to type
// into: messages queue, and the Dispatcher appends them to an agent's next
// prompt (`take`).

import type { Hub } from "./hub";

export interface InboxItem {
  fromId: string; // agent id or "you"
  text: string;
  kind: "message" | "assign" | "notice"; // notice = from HQ itself (e.g. review results)
}

export class Inbox {
  private queues = new Map<string, InboxItem[]>();

  constructor(private hub: Hub) {}

  push(agentId: string, item: InboxItem) {
    this.queues.set(agentId, [...(this.queues.get(agentId) ?? []), item]);
  }

  pending(agentId: string) {
    return this.queues.get(agentId)?.length ?? 0;
  }

  /** The queued items as a text block for the agent's next prompt, and clears the queue. */
  take(agentId: string): string | null {
    const q = this.queues.get(agentId);
    if (!q?.length) return null;
    this.queues.set(agentId, []);
    return this.format(q);
  }

  forget(agentId: string) {
    this.queues.delete(agentId);
  }

  private format(items: InboxItem[]): string {
    const lines = items.map((i) => (i.kind === "message" ? `[HQ] Message from ${this.hub.name(i.fromId)}: ${i.text}` : `[HQ] ${i.text}`));
    return lines.join("\n");
  }
}
