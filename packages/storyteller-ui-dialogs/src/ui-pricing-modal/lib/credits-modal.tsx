import { useState } from "react";
import { twMerge } from "tailwind-merge";
import { Modal } from "@storyteller/ui-modal";
import { ArrowRightIcon, CoinsIcon, LoaderCircleIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface CreditPack {
  id: string;
  total: number;
  base: number;
  bonus: number;
  priceUsd: number;
  badge?: string;
  priceId?: string;
}

const creditPacks: CreditPack[] = [
  { id: "artcraft_1000", total: 1000, base: 1000, bonus: 0, priceUsd: 10 },
  { id: "artcraft_2500", total: 2500, base: 2500, bonus: 0, priceUsd: 25 },
  {
    id: "artcraft_5000",
    total: 5000,
    base: 5000,
    bonus: 0,
    priceUsd: 50,
    badge: "Popular",
  },
  { id: "artcraft_10000", total: 10000, base: 10000, bonus: 0, priceUsd: 100 },
];

interface CreditsModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onPurchase?: (pack: CreditPack) => void;
}

export function CreditsModal({ isOpen = false, onClose, onPurchase }: CreditsModalProps) {
  const [purchasingId, setPurchasingId] = useState<string | null>(null);

  const handlePurchase = async (pack: CreditPack) => {
    if (onPurchase) {
      onPurchase(pack);
      return;
    }

    setPurchasingId(pack.id);
    try {
      await invoke("storyteller_open_credits_purchase_command", {
        request: {
          credits_pack: pack.id,
        },
      });
    } finally {
      setPurchasingId(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose ?? (() => {})}
      className="w-full max-w-2xl max-h-[100vh] overflow-y-auto overflow-x-hidden border border-outline-variant bg-surface-container-lowest p-0"
      allowBackgroundInteraction={false}
      showClose={true}
      closeOnOutsideClick={true}
      resizable={false}
      childPadding={false}
      backdropClassName="bg-scrim/80"
    >
      <div className="relative overflow-hidden">
        <div className="relative px-8 pt-10 pb-8 sm:px-10 sm:pt-11 sm:pb-9">
          <h2 className="font-display text-3xl font-semibold tracking-tight text-on-surface sm:text-[34px] sm:leading-[1.1]">
            Buy <span className="text-primary">credits</span>
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-on-surface/55">
            One-time credit packs. No subscription required.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {creditPacks.map(pack => {
              const isLoading = purchasingId === pack.id;
              const isPopular = !!pack.badge;
              return (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => handlePurchase(pack)}
                  disabled={purchasingId !== null}
                  className={twMerge(
                    "group relative flex flex-col gap-6 border p-6 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60",
                    isPopular
                      ? "border-outline bg-on-surface/[0.06] hover:border-outline"
                      : "border-outline-variant bg-on-surface/[0.02] hover:border-outline hover:bg-on-surface/[0.04]",
                  )}
                >
                  {pack.badge && (
                    <span className="absolute -top-2.5 right-3 bg-on-surface px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-surface">
                      {pack.badge}
                    </span>
                  )}

                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center bg-on-surface/10">
                      <CoinsIcon className="text-on-surface text-lg" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-4xl font-bold leading-none tracking-tight text-on-surface">
                        {pack.total.toLocaleString()}
                      </div>
                      <div className="mt-0 text-sm text-on-surface/40">
                        {pack.bonus > 0 ? (
                          <>
                            {pack.base.toLocaleString()} +{" "}
                            <span className="font-semibold text-on-surface">{pack.bonus.toLocaleString()} bonus</span>
                          </>
                        ) : (
                          "credits"
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-semibold text-on-surface/80">${pack.priceUsd}</span>
                    <span className="flex items-center gap-1.5 text-base font-semibold text-on-surface">
                      {isLoading ? (
                        <LoaderCircleIcon className="animate-spin" />
                      ) : (
                        <>
                          Buy
                          <ArrowRightIcon className="text-xs transition-transform group-hover:translate-x-0.5" />
                        </>
                      )}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <p className="mt-6 text-center text-xs text-on-surface/35">Secure checkout via Stripe.</p>
        </div>
      </div>
    </Modal>
  );
}

export default CreditsModal;
