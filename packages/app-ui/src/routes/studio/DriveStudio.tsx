// SPDX-License-Identifier: Apache-2.0
// Google Drive: authorise once (OAuth loopback, crates/ui/app/src/studio.rs) and mount
// a Drive folder as a Spacedrive cloud volume (OpenDAL gdrive) with an indexed location.
import { useState } from "react";
import { Button, Card } from "@aphrody/m3-primitives";
import type { LocationAddInput, VolumeAddCloudInput } from "@aphrody/drive-client";
import { StudioHeader } from "./StudioHeader";
import { useLibraryMutation } from "../../contexts/SpacedriveContext";
import { isTauri } from "../../tauri-bridge";
import { authorizeGoogleDrive } from "../../studio-bridge";

const buttonClass = "min-h-12 px-5 text-[18px]";
const fieldClass = "min-h-12 rounded-xl border border-outline bg-surface-container px-4 text-[18px]";

export function DriveStudio() {
  const addCloudVolume = useLibraryMutation("volumes.add_cloud");
  const addLocation = useLibraryMutation("locations.add");
  const [root, setRoot] = useState("/aphrody");
  const [step, setStep] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isTauri()) {
    return <p className="text-[18px] text-on-surface-variant">Google Drive nécessite l’application Aphrody.</p>;
  }

  const connect = async () => {
    setError(null);
    setDone(null);
    try {
      setStep("Autorisation Google dans le navigateur…");
      const grant = await authorizeGoogleDrive();
      setStep("Montage du dossier…");
      const folder = root.trim() || "/aphrody";
      const volume: VolumeAddCloudInput = {
        service: "gdrive",
        display_name: "Google Drive",
        config: {
          type: "GoogleDrive",
          root: folder,
          access_token: grant.access_token,
          refresh_token: grant.refresh_token,
          client_id: grant.client_id,
          client_secret: grant.client_secret,
        },
      };
      await addCloudVolume.mutateAsync(volume);
      setStep("Indexation…");
      const location: LocationAddInput = {
        path: { Cloud: { service: "gdrive", identifier: folder, path: "" } },
        name: "Google Drive",
        mode: "Deep",
        job_policies: {},
      };
      await addLocation.mutateAsync(location);
      setDone(`Dossier ${folder} monté et en cours d’indexation dans Fichiers.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStep(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <StudioHeader
        eyebrow="Google Drive"
        title="Drive"
        subtitle="Dossier Google Drive monté dans Fichiers (Spacedrive)"
      />
      <Card className="flex flex-col gap-4 p-6">
        <label className="flex flex-col gap-2 text-[18px]">
          Dossier Google Drive
          <input className={fieldClass} value={root} onChange={event => setRoot(event.target.value)} />
        </label>
        <Button className={buttonClass} disabled={step !== null} onClick={() => void connect()}>
          {step ?? "Connecter et monter"}
        </Button>
        {done ? <p className="text-[18px] text-primary">{done}</p> : null}
        {error ? (
          <p role="alert" className="text-[18px] text-error">
            {error}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
