// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import {
  AphrodyAvatar,
  AphrodyPet,
  PET,
  type PetAnimation,
} from "@aphrody/identity";
import { PET_ATLAS_URL } from "@aphrody/identity/atlas";
import {
  configureBrowserCanvas,
  createM3CanvasSurface,
  selectCanvasBackend,
} from "@aphrody/canvas/browser";
import { getIcon } from "@aphrody/assets/util";
import { useM3Theme } from "@aphrody/m3-theme/react";
import nieKit, { resolved as nieResolved } from "m3:optional/@aphrody/nie-ui";
import { Card, Code, Page, Section } from "../components/ui.tsx";
import type { PageProps } from "./index.ts";

const kits = [
  { name: "@aphrody/nie-ui", resolved: nieResolved, namespace: nieKit },
];
export default function Brands({ adaptive }: PageProps) {
  const theme = useM3Theme();
  const [animation, setAnimation] = useState<PetAnimation>("idle");
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    configureBrowserCanvas(element, {
      width: 420,
      height: 180,
      m3: createM3CanvasSurface({ colorScheme: theme.resolvedTheme }),
    });
    const context = element.getContext("2d");
    if (!context) return;
    const style = getComputedStyle(element);
    const ratio = devicePixelRatio || 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = style
      .getPropertyValue("--md-sys-color-surface-container")
      .trim();
    context.fillRect(0, 0, 420, 180);
    context.fillStyle = style.getPropertyValue("--md-sys-color-primary").trim();
    context.fillRect(20, 20, 380, 140);
    context.fillStyle = style
      .getPropertyValue("--md-sys-color-on-primary")
      .trim();
    context.font = "500 24px " + style.fontFamily;
    context.fillText("Aphrody M3", 40, 82);
    context.font = "400 16px " + style.fontFamily;
    context.fillText("Canvas follows the live theme", 40, 114);
  }, [
    theme.seedColor,
    theme.resolvedTheme,
    theme.variant,
    theme.contrastLevel,
  ]);
  return (
    <Page
      title="Brands"
      summary="Explore Aphrody's canonical identity, animated pet, adaptive canvas surface and shared file assets."
      packages={["@aphrody/identity", "@aphrody/canvas", "@aphrody/assets"]}
      panes={adaptive.panes}
      aside={
        <Card>
          <h3 className="text-title-medium">Host kits</h3>
          <p className="text-body-medium text-on-surface-variant">
            Optional modules report their actual resolution in this workspace.
          </p>
          {kits.map((kit) => (
            <div key={kit.name} className="mt-3">
              <p className="text-label-large">{kit.name}</p>
              <p className="text-body-medium">
                {kit.resolved ? "Resolved" : "External host package"}
              </p>
              {kit.namespace ? (
                <Code>{Object.keys(kit.namespace).join("\n")}</Code>
              ) : null}
            </div>
          ))}
        </Card>
      }
    >
      <Section title="Aphrody identity">
        <Card className="flex flex-wrap items-center gap-5">
          {[32, 64, 96].map((size) => (
            <AphrodyAvatar
              key={size}
              size={size}
              label={"Aphrody emblem at " + size + " pixels"}
            />
          ))}
          <div>
            <h3 className="text-title-large">Aphrody</h3>
            <p className="text-body-medium text-on-surface-variant">
              One brand asset source, with adaptive pixel density.
            </p>
          </div>
        </Card>
      </Section>
      <Section
        title="Animated pet"
        description="The canonical atlas and timed tracks honour reduced-motion preferences."
      >
        <Card className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-label-large">
            Animation
            <select
              className="h-12 rounded-small border border-outline bg-surface px-3"
              value={animation}
              onChange={(event) =>
                setAnimation(event.target.value as PetAnimation)
              }
            >
              {Object.keys(PET.tracks).map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <AphrodyPet
            atlasUrl={PET_ATLAS_URL}
            animation={animation}
            height={160}
            label="Aphrody animated pet"
          />
        </Card>
      </Section>
      <Section
        title="Canvas surface"
        description="The browser canvas adapter sizes the backing surface for the display's pixel ratio."
      >
        <Card>
          <canvas
            ref={canvas}
            width={420}
            height={180}
            style={{ width: "100%", maxWidth: 420, height: "auto" }}
            role="img"
            aria-label="Aphrody Material 3 canvas using the current theme"
          >
            Aphrody M3 canvas.
          </canvas>
          <Code>
            {JSON.stringify(
              {
                backend: selectCanvasBackend("browser"),
                surface: createM3CanvasSurface({
                  colorScheme: theme.resolvedTheme,
                }),
              },
              null,
              2,
            )}
          </Code>
        </Card>
      </Section>
      <Section title="Shared file assets">
        <div className="grid grid-cols-3 gap-3 expanded:grid-cols-6">
          {["Document", "Image", "Audio", "Video", "Code", "Archive"].map(
            (kind) => (
              <Card key={kind} className="flex flex-col items-center gap-2">
                <img
                  src={String(getIcon(kind, theme.resolvedTheme === "dark"))}
                  width={48}
                  height={48}
                  alt={kind + " file icon"}
                />
                <span className="text-label-large">{kind}</span>
              </Card>
            ),
          )}
        </div>
      </Section>
    </Page>
  );
}
