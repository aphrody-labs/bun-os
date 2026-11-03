// SPDX-License-Identifier: Apache-2.0
/**
 * @aphrody/m3-ai - A2APeerInspector
 *
 * Material Design 3 Agent-to-Agent (A2A 1.0) Fleet Inspector:
 * - Visualizes connected peer agents (codex, claude, agycli, nie, ocr, rag, ...).
 * - Displays AgentCard interface, capabilities, and active tasks.
 * - Live inspection of .coord mailbox envelopes (ask, fact, ack, ping, error).
 * - File lock & resource claims view (.coord/claims).
 */

import React, { useState } from "react";
import { clsx } from "clsx";
import type { CoordEnvelope, EnvelopeKind } from "./AgUiEventStream";

export interface AgentPeer {
  id: string;
  name: string;
  role: string;
  status: "idle" | "busy" | "offline";
  version?: string;
  skills?: string[];
  activeClaim?: string;
}

export interface SendEnvelopePayload {
  from: string;
  to?: string;
  kind: EnvelopeKind | string;
  topic: string;
  body: string;
  re?: string;
  channel_hint?: string[];
  v?: number;
  [key: string]: unknown;
}

export interface A2APeerInspectorProps {
  peers?: AgentPeer[];
  envelopes?: CoordEnvelope[];
  selectedPeerId?: string;
  onSelectPeer?: (peerId: string) => void;
  onSendEnvelope?: (envelope: SendEnvelopePayload) => void;
  className?: string;
}

const EMPTY_ENVELOPES: CoordEnvelope[] = [];

const DEFAULT_PEERS: AgentPeer[] = [
  {
    id: "agy",
    name: "Antigravity Core",
    role: "Integrator & UI / Rust Lead",
    status: "busy",
    version: "2.0.0",
    skills: ["m3-ui", "rust-serial", "bun-native", "a2a-coord"],
    activeClaim: ".coord/claims/native-integration.json",
  },
  {
    id: "codex",
    name: "Codex Peer",
    role: "Backend & Systems Worker",
    status: "busy",
    version: "1.4.0",
    skills: ["native-wiring", "wsl-probe", "kernel-ffi"],
  },
  {
    id: "claude",
    name: "Claude Peer",
    role: "Architecture & Verification",
    status: "idle",
    version: "3.7.0",
    skills: ["design-tokens", "docs-audit", "review"],
  },
];

const KIND_COLORS: Record<EnvelopeKind, { bg: string; text: string; border: string }> = {
  ask: {
    bg: "bg-primary-container",
    text: "text-on-primary-container",
    border: "border-primary",
  },
  fact: {
    bg: "bg-tertiary-container",
    text: "text-on-tertiary-container",
    border: "border-tertiary",
  },
  ack: {
    bg: "bg-secondary-container",
    text: "text-on-secondary-container",
    border: "border-secondary",
  },
  ping: {
    bg: "bg-surface-container-high",
    text: "text-on-surface-variant",
    border: "border-outline-variant",
  },
  error: {
    bg: "bg-error-container",
    text: "text-on-error-container",
    border: "border-error",
  },
};

export const A2APeerInspector: React.FC<A2APeerInspectorProps> = ({
  peers = DEFAULT_PEERS,
  envelopes = EMPTY_ENVELOPES,
  selectedPeerId: controlledPeerId,
  onSelectPeer,
  onSendEnvelope,
  className,
}) => {
  const [internalSelectedPeerId, setInternalSelectedPeerId] = useState<string>(peers[0]?.id || "agy");
  const selectedPeerId = controlledPeerId ?? internalSelectedPeerId;

  // Form state for composing envelope
  const [composeTopic, setComposeTopic] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeKind, setComposeKind] = useState<EnvelopeKind>("ask");

  const currentPeer = peers.find(p => p.id === selectedPeerId) || peers[0];

  const handleSelect = (peerId: string) => {
    setInternalSelectedPeerId(peerId);
    onSelectPeer?.(peerId);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeTopic.trim() || !composeBody.trim()) return;

    onSendEnvelope?.({
      from: "agy",
      to: selectedPeerId,
      kind: composeKind,
      topic: composeTopic.trim(),
      body: composeBody.trim(),
    });

    setComposeTopic("");
    setComposeBody("");
  };

  const filteredEnvelopes = envelopes.filter(
    env => env.from === selectedPeerId || env.to === selectedPeerId || env.to === "fleet",
  );

  return (
    <div
      className={clsx(
        "flex flex-col gap-4 rounded-3xl p-5 border",
        "bg-surface-container-lowest",
        "border-outline-variant",
        "text-on-surface",
        className,
      )}
    >
      {/* Header & Peer Chips */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-xl text-primary">hub</span>
            <h2 className="text-base font-semibold tracking-tight">A2A Fleet Coordinator</h2>
            <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-xs font-mono text-on-surface-variant">
              v1.0 (JSONL + RPC)
            </span>
          </div>
          <span className="text-xs text-outline">{peers.length} active peers</span>
        </div>

        {/* Peer selection chips */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {peers.map(peer => {
            const isSelected = peer.id === selectedPeerId;
            return (
              <button
                key={peer.id}
                type="button"
                onClick={() => handleSelect(peer.id)}
                className={clsx(
                  "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors shrink-0",
                  isSelected
                    ? "bg-secondary-container text-on-secondary-container shadow-sm"
                    : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high",
                )}
              >
                <span
                  className={clsx(
                    "h-2 w-2 rounded-full",
                    peer.status === "busy"
                      ? "bg-warning animate-pulse motion-reduce:animate-none"
                      : peer.status === "idle"
                        ? "bg-success"
                        : "bg-outline",
                  )}
                />
                <span>{peer.name}</span>
                <span className="text-[10px] opacity-60">@{peer.id}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Peer Details Card */}
      {currentPeer && (
        <div className="flex flex-col gap-2 rounded-2xl bg-surface-container-low p-4 border border-outline-variant/50">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{currentPeer.name}</span>
                <span className="text-xs text-on-surface-variant">({currentPeer.role})</span>
              </div>
              <div className="text-xs text-outline mt-0.5">
                Peer ID: <code className="font-mono text-xs">{currentPeer.id}</code> · Version:{" "}
                {currentPeer.version || "1.0.0"}
              </div>
            </div>
            {currentPeer.activeClaim && (
              <div className="flex items-center gap-1.5 rounded-lg bg-warning-container px-2 py-1 text-xs text-on-warning-container border border-warning/20">
                <span className="material-symbols-outlined text-sm">lock</span>
                <span className="font-mono text-[11px]">{currentPeer.activeClaim}</span>
              </div>
            )}
          </div>

          {currentPeer.skills && currentPeer.skills.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {currentPeer.skills.map(skill => (
                <span
                  key={skill}
                  className="rounded-md bg-surface-container-highest px-2 py-0.5 text-[11px] font-mono text-on-surface-variant"
                >
                  #{skill}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Envelope Stream Section */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
            Coordination Envelopes ({filteredEnvelopes.length})
          </h3>
          <span className="text-[11px] text-outline">.coord/inbox & .coord/outbox</span>
        </div>

        {filteredEnvelopes.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-surface-container-lowest border border-dashed border-outline-variant text-xs text-outline">
            <span className="material-symbols-outlined text-2xl mb-1 opacity-50">mark_email_read</span>
            No pending envelopes for @{selectedPeerId}. Fleet mailbox is synchronized.
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
            {filteredEnvelopes.map(env => {
              const kind = (env.kind in KIND_COLORS ? env.kind : "ping") as EnvelopeKind;
              const style = KIND_COLORS[kind];

              return (
                <div
                  key={env.id}
                  className={clsx(
                    "flex flex-col gap-1.5 rounded-xl p-3 border text-xs transition-shadow",
                    "bg-surface-container-low",
                    style.border,
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={clsx(
                          "rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase",
                          style.bg,
                          style.text,
                        )}
                      >
                        {env.kind}
                      </span>
                      <span className="font-semibold">{env.topic}</span>
                    </div>
                    <span className="text-[10px] font-mono text-outline">
                      {env.from} → {env.to || "all"}
                    </span>
                  </div>

                  <p className="line-clamp-2 text-xs text-on-surface-variant font-mono whitespace-pre-wrap">
                    {env.body}
                  </p>

                  <div className="flex items-center justify-between pt-1 border-t border-outline-variant/30 text-[10px] text-outline font-mono">
                    <span>id: {env.id}</span>
                    {env.re && <span>re: {env.re}</span>}
                    <span>{new Date(env.ts).toLocaleTimeString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Compose Form */}
      <form onSubmit={handleSend} className="flex flex-col gap-2.5 pt-2 border-t border-outline-variant/50">
        <div className="flex items-center gap-2">
          <select
            value={composeKind}
            onChange={e => setComposeKind(e.target.value as EnvelopeKind)}
            className="rounded-xl border border-outline-variant bg-surface-container-low px-2.5 py-1.5 text-xs font-medium text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="ask">ASK</option>
            <option value="fact">FACT</option>
            <option value="ack">ACK</option>
            <option value="ping">PING</option>
            <option value="error">ERROR</option>
          </select>

          <input
            type="text"
            placeholder="Topic (e.g. work, claim-check, verification)..."
            value={composeTopic}
            onChange={e => setComposeTopic(e.target.value)}
            className="flex-1 rounded-xl border border-outline-variant bg-surface-container-low px-3 py-1.5 text-xs text-on-surface placeholder-outline focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder={`Message body to @${selectedPeerId}...`}
            value={composeBody}
            onChange={e => setComposeBody(e.target.value)}
            className="flex-1 rounded-xl border border-outline-variant bg-surface-container-low px-3 py-1.5 text-xs text-on-surface placeholder-outline focus:outline-none focus:ring-1 focus:ring-primary"
          />

          <button
            type="submit"
            disabled={!composeTopic.trim() || !composeBody.trim()}
            className={clsx(
              "flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-semibold transition-all",
              composeTopic.trim() && composeBody.trim()
                ? "bg-primary text-on-primary hover:opacity-90 shadow-sm"
                : "bg-surface-container-high text-outline cursor-not-allowed",
            )}
          >
            <span>Dispatch</span>
            <span className="material-symbols-outlined text-sm">send</span>
          </button>
        </div>
      </form>
    </div>
  );
};
