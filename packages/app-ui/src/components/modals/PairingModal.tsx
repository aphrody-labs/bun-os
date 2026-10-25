import { useState, useEffect, useId, useRef } from "react";
import { QrCode, X, ArrowsClockwise, Check, Warning, DeviceMobile, Copy, CaretDown } from "@phosphor-icons/react";
import { motion, AnimatePresence } from "motion/react";
import { clsx } from "clsx";
import { drawQr } from "@aphrody/qr";
import { useCoreMutation, useCoreQuery } from "../../contexts/SpacedriveContext";
import { sounds } from "@aphrody/assets/sounds";
import { Icon } from "@aphrody/m3-primitives";
import { useDialogFocus } from "../../hooks/useDialogFocus";

interface PairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: "generate" | "join";
}

export function PairingModal({ isOpen, onClose, mode: initialMode = "generate" }: PairingModalProps) {
  const [mode, setMode] = useState<"generate" | "join">(initialMode);
  const [joinCode, setJoinCode] = useState("");
  const [joinNodeId, setJoinNodeId] = useState("");

  const generatePairing = useCoreMutation("network.pair.generate");
  const joinPairing = useCoreMutation("network.pair.join");
  const cancelPairing = useCoreMutation("network.pair.cancel");

  const { data: pairingStatus, refetch: refetchStatus } = useCoreQuery({
    type: "network.pair.status",
    input: null,
  });

  // Poll status when in active pairing
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      refetchStatus();
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, refetchStatus]);

  const currentSession = pairingStatus?.sessions?.[0];

  const handleGenerate = () => {
    generatePairing.mutate({});
  };

  const handleJoin = () => {
    if (!joinCode.trim()) return;
    joinPairing.mutate({
      code: joinCode,
      node_id: joinNodeId.trim() || null,
    });
  };

  const handleCancel = () => {
    if (currentSession) {
      cancelPairing.mutate({ session_id: currentSession.id });
    }
    generatePairing.reset();
    joinPairing.reset();
    setJoinCode("");
    setJoinNodeId("");
  };

  const handleClose = () => {
    handleCancel();
    onClose();
  };

  const copyCode = () => {
    if (generatePairing.data?.code) {
      navigator.clipboard.writeText(generatePairing.data.code);
    }
  };

  // Check if pairing completed
  const isCompleted = currentSession?.state === "Completed" || joinPairing.isSuccess;

  // Latest close handler, read by the delayed close timer without restarting it on each render
  const handleCloseRef = useRef(handleClose);
  useEffect(() => {
    handleCloseRef.current = handleClose;
  });

  useEffect(() => {
    if (isCompleted) {
      sounds.pairing();
      const timer = setTimeout(() => {
        handleCloseRef.current();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isCompleted]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useDialogFocus(dialogRef, { open: isOpen, onEscape: handleClose });

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={handleClose}
        />

        {/* Modal */}
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-xl bg-surface-container border border-outline-variant rounded-medium shadow-md3-5 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
            <div className="flex items-center gap-3">
              <DeviceMobile className="size-6 text-primary" weight="bold" />
              <div>
                <h2 id={titleId} className="text-title-medium font-semibold text-on-surface">
                  Device pairing
                </h2>
                <p id={descriptionId} className="text-body-small text-on-surface-variant">Connect another device to share files</p>
              </div>
            </div>
            <button aria-label="Close" onClick={handleClose} className="p-1.5 hover:bg-on-surface/8 rounded-small transition-colors">
              <X className="size-5 text-on-surface-variant" weight="bold" />
            </button>
          </div>

          {/* Mode Tabs */}
          <div className="flex border-b border-outline-variant">
            <button
              onClick={() => setMode("generate")}
              className={clsx(
                "flex-1 px-6 py-3 text-label-large font-medium transition-colors",
                mode === "generate"
                  ? "text-primary border-b-2 border-primary"
                  : "text-on-surface-variant hover:text-on-surface",
              )}
            >
              Generate code
            </button>
            <button
              onClick={() => setMode("join")}
              className={clsx(
                "flex-1 px-6 py-3 text-label-large font-medium transition-colors",
                mode === "join"
                  ? "text-primary border-b-2 border-primary"
                  : "text-on-surface-variant hover:text-on-surface",
              )}
            >
              Join with code
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {mode === "generate" ? (
              <GenerateMode
                generatePairing={generatePairing}
                currentSession={currentSession}
                onGenerate={handleGenerate}
                onCancel={handleCancel}
                onCopyCode={copyCode}
              />
            ) : (
              <JoinMode
                joinCode={joinCode}
                setJoinCode={setJoinCode}
                joinNodeId={joinNodeId}
                setJoinNodeId={setJoinNodeId}
                joinPairing={joinPairing}
                currentSession={currentSession}
                onJoin={handleJoin}
                onCancel={handleCancel}
              />
            )}

            {/* Success State */}
            {isCompleted && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 p-4 bg-primary/10 border border-primary/30 rounded-small"
              >
                <Check className="size-5 text-primary" weight="bold" />
                <div className="flex-1">
                  <p className="text-label-large font-medium text-primary">Pairing successful!</p>
                  <p className="text-body-small text-on-surface-variant mt-0.5">
                    {joinPairing.data ? `Connected to ${joinPairing.data.device_name}` : "Device paired"}
                  </p>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

function GenerateMode({ generatePairing, currentSession, onGenerate, onCancel, onCopyCode }: any) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const hasCode = generatePairing.data?.code;
  const isLoading = generatePairing.isPending;
  const state = currentSession?.state;

  const copyQRJson = () => {
    if (generatePairing.data?.qr_json) {
      navigator.clipboard.writeText(generatePairing.data.qr_json);
    }
  };

  return (
    <>
      {!hasCode ? (
        <>
          {/* Setup */}
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-surface-container/40 rounded-small border border-outline-variant">
              <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <QrCode className="size-5 text-primary" weight="bold" />
              </div>
              <div className="flex-1">
                <h3 className="text-label-large font-medium text-on-surface">How it works</h3>
                <p className="text-body-small text-on-surface-variant mt-1">
                  Generate a secure code to share with another device. They'll enter the code to establish a trusted
                  connection.
                </p>
              </div>
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={onGenerate}
            disabled={isLoading}
            className={clsx(
              "w-full flex items-center justify-center gap-2 px-4 py-3 rounded-small font-medium transition-colors",
              isLoading ? "bg-primary/50 cursor-not-allowed" : "bg-primary hover:bg-primary/90 text-white",
            )}
          >
            {isLoading && <ArrowsClockwise className="size-5 animate-spin" weight="bold" />}
            {isLoading ? "Generating..." : "Generate pairing code"}
          </button>
        </>
      ) : (
        <>
          {/* Generated Code Display */}
          <div className="space-y-4">
            {/* QR Code */}
            <div className="flex flex-col items-center gap-3">
              <p className="text-body-medium text-on-surface-variant">Scan with mobile device</p>
              <div className="inline-block p-4 bg-white rounded-small">
                <QRCodeCanvas data={generatePairing.data.qr_json} size={192} />
              </div>
            </div>

            {/* Word Code */}
            <div>
              <div className="text-label-medium font-medium text-on-surface-variant uppercase tracking-wider mb-2 block">
                Or type manually:
              </div>
              <div className="relative">
                <div className="p-4 bg-surface-container border border-outline-variant rounded-small font-mono text-body-medium text-on-surface break-all">
                  {generatePairing.data.code}
                </div>
                <button
                  onClick={onCopyCode}
                  className="absolute top-2 right-2 p-2 bg-surface-container hover:bg-on-surface/8 border border-outline-variant rounded-small transition-colors"
                  title="Copy code"
                >
                  <Copy className="size-4 text-on-surface-variant" weight="bold" />
                </button>
              </div>
            </div>

            {/* Node ID for cross-network pairing */}
            {generatePairing.data.node_id && (
              <div>
                <div className="text-label-medium font-medium text-on-surface-variant uppercase tracking-wider mb-2 block">
                  For cross-network pairing:
                </div>
                <div className="relative">
                  <div className="p-3 bg-surface-container border border-outline-variant rounded-small font-mono text-body-small text-on-surface break-all">
                    {generatePairing.data.node_id}
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(generatePairing.data.node_id)}
                    className="absolute top-1.5 right-1.5 p-1.5 bg-surface-container hover:bg-on-surface/8 border border-outline-variant rounded-small transition-colors"
                    title="Copy node ID"
                  >
                    <Copy className="size-3 text-on-surface-variant" weight="bold" />
                  </button>
                </div>
                <p className="text-body-small text-on-surface-variant mt-1.5">
                  Share this Node ID if devices are on different networks
                </p>
              </div>
            )}

            {/* Status */}
            <div className="flex items-center gap-2 p-3 bg-surface-container/40 rounded-small border border-outline-variant">
              <div className="size-2 rounded-full bg-primary animate-pulse" />
              <span className="text-body-medium text-on-surface-variant">
                {state === "Broadcasting" || state === "WaitingForConnection"
                  ? "Waiting for device to connect..."
                  : state === "Authenticating"
                    ? "Authenticating device..."
                    : state === "ExchangingKeys"
                      ? "Exchanging encryption keys..."
                      : "Ready to pair"}
              </span>
            </div>

            {/* Advanced Section */}
            <div className="border-t border-outline-variant pt-4">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-body-small text-on-surface-variant hover:text-on-surface transition-colors mx-auto"
              >
                <span>Advanced</span>
                <CaretDown
                  className={clsx("size-3 transition-transform", showAdvanced && "rotate-180")}
                  weight="bold"
                />
              </button>

              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 space-y-2">
                      <div className="p-3 bg-surface-container/40 rounded-small border border-outline-variant">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-body-small text-on-surface-variant">Session ID</span>
                          <button
                            onClick={() => navigator.clipboard.writeText(generatePairing.data.session_id)}
                            className="p-1 hover:bg-on-surface/8 rounded-extra-small transition-colors"
                          >
                            <Copy className="size-3 text-on-surface-variant" weight="bold" />
                          </button>
                        </div>
                        <code className="text-body-small text-on-surface font-mono break-all">
                          {generatePairing.data.session_id}
                        </code>
                      </div>

                      <div className="p-3 bg-surface-container/40 rounded-small border border-outline-variant">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-body-small text-on-surface-variant">QR JSON</span>
                          <button aria-label="Copy"
                            onClick={copyQRJson}
                            className="p-1 hover:bg-on-surface/8 rounded-extra-small transition-colors"
                          >
                            <Copy className="size-3 text-on-surface-variant" weight="bold" />
                          </button>
                        </div>
                        <code className="text-body-small text-on-surface font-mono break-all line-clamp-2">
                          {generatePairing.data.qr_json}
                        </code>
                      </div>

                      {generatePairing.data.expires_at && (
                        <p className="text-body-small text-on-surface-variant text-center pt-2">
                          Expires at {new Date(generatePairing.data.expires_at).toLocaleTimeString()}
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Cancel Button */}
          <button
            aria-label="Cancel"
            title="Cancel"
            onClick={onCancel}
            className="w-full px-4 py-2.5 text-label-large font-medium text-on-surface-variant hover:text-on-surface bg-surface-container hover:bg-on-surface/8 border border-outline-variant rounded-small transition-colors"
          >
            <Icon name="close" size={18} />
          </button>
        </>
      )}

      {/* Error */}
      {generatePairing.isError && (
        <div className="flex items-start gap-2 p-3 bg-error/10 border border-error/30 rounded-small">
          <Warning className="size-5 text-error shrink-0 mt-0.5" weight="bold" />
          <div className="flex-1">
            <p className="text-label-large font-medium text-error">Failed to generate code</p>
            <p className="text-body-small text-on-surface-variant mt-0.5">{String(generatePairing.error)}</p>
          </div>
        </div>
      )}
    </>
  );
}

function JoinMode({
  joinCode,
  setJoinCode,
  joinNodeId,
  setJoinNodeId,
  joinPairing,
  currentSession,
  onJoin,
  onCancel,
}: any) {
  const isLoading = joinPairing.isPending;
  const state = currentSession?.state;

  return (
    <>
      <div className="space-y-4">
        {/* Instructions */}
        <div className="flex items-start gap-3 p-4 bg-surface-container/40 rounded-small border border-outline-variant">
          <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <QrCode className="size-5 text-primary" weight="bold" />
          </div>
          <div className="flex-1">
            <h3 className="text-label-large font-medium text-on-surface">Enter pairing code</h3>
            <p className="text-body-small text-on-surface-variant mt-1">
              Enter the 12-word code from the other device to establish a secure connection.
            </p>
          </div>
        </div>

        {/* Code Input */}
        <div>
          <label
            htmlFor="pairing-join-code"
            className="text-label-medium font-medium text-on-surface-variant uppercase tracking-wider mb-2 block"
          >
            Pairing code
          </label>
          <textarea
            id="pairing-join-code"
            value={joinCode}
            onChange={e => setJoinCode(e.target.value)}
            placeholder="brave-lion-sunset-river-eagle-mountain-forest-ocean-thunder-crystal-diamond-phoenix"
            rows={3}
            disabled={isLoading || !!state}
            className="w-full px-4 py-3 bg-surface-container border border-outline-variant rounded-small text-body-medium text-on-surface placeholder:text-outline resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
          />
          <p className="text-body-small text-on-surface-variant mt-2">
            Paste the full code or type the 12 words separated by hyphens
          </p>
        </div>

        {/* Node ID Input (optional, for cross-network) */}
        <div>
          <label
            htmlFor="pairing-join-node-id"
            className="text-label-medium font-medium text-on-surface-variant uppercase tracking-wider mb-2 block"
          >
            Node ID <span className="text-outline">(optional)</span>
          </label>
          <input
            id="pairing-join-node-id"
            type="text"
            value={joinNodeId}
            onChange={e => setJoinNodeId(e.target.value)}
            placeholder="Enter Node ID for cross-network pairing"
            disabled={isLoading || !!state}
            className="w-full px-4 py-2.5 bg-surface-container border border-outline-variant rounded-small text-body-small text-on-surface font-mono placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
          />
          <p className="text-body-small text-on-surface-variant mt-1.5">
            Required if devices are on different networks
          </p>
        </div>

        {/* Status */}
        {state && (
          <div className="flex items-center gap-2 p-3 bg-surface-container/40 rounded-small border border-outline-variant">
            <div className="size-2 rounded-full bg-primary animate-pulse" />
            <span className="text-body-medium text-on-surface-variant">
              {state === "Scanning" || state === "Connecting"
                ? "Finding device..."
                : state === "Authenticating"
                  ? "Authenticating..."
                  : state === "ExchangingKeys"
                    ? "Exchanging keys..."
                    : state === "EstablishingSession"
                      ? "Establishing secure session..."
                      : "Processing..."}
            </span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        {state ? (
          <button
            aria-label="Cancel"
            title="Cancel"
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-label-large font-medium text-on-surface-variant hover:text-on-surface bg-surface-container hover:bg-on-surface/8 border border-outline-variant rounded-small transition-colors"
          >
            <Icon name="close" size={18} />
          </button>
        ) : (
          <>
            <button
              onClick={onCancel}
              className="px-6 py-2.5 text-label-large font-medium text-on-surface-variant hover:text-on-surface bg-surface-container hover:bg-on-surface/8 border border-outline-variant rounded-small transition-colors"
            >
              Clear
            </button>
            <button
              onClick={onJoin}
              disabled={isLoading || !joinCode.trim()}
              className={clsx(
                "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-small font-medium transition-colors",
                isLoading || !joinCode.trim()
                  ? "bg-primary/50 text-white/70 cursor-not-allowed"
                  : "bg-primary hover:bg-primary/90 text-white",
              )}
            >
              {isLoading && <ArrowsClockwise className="size-5 animate-spin" weight="bold" />}
              {isLoading ? "Joining..." : "Join"}
            </button>
          </>
        )}
      </div>

      {/* Error */}
      {joinPairing.isError && (
        <div className="flex items-start gap-2 p-3 bg-error/10 border border-error/30 rounded-small">
          <Warning className="size-5 text-error shrink-0 mt-0.5" weight="bold" />
          <div className="flex-1">
            <p className="text-label-large font-medium text-error">Failed to join</p>
            <p className="text-body-small text-on-surface-variant mt-0.5">{String(joinPairing.error)}</p>
          </div>
        </div>
      )}
    </>
  );
}

// QR Code Canvas Component (avoids React version conflicts)
function QRCodeCanvas({ data, size }: { data: string; size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && data) {
      try {
        drawQr(canvasRef.current, data, {
          width: size,
          margin: 1,
          errorCorrectionLevel: "M",
        });
      } catch (err: unknown) {
        console.error("Failed to generate QR code:", err);
      }
    }
  }, [data, size]);

  return <canvas ref={canvasRef} />;
}
