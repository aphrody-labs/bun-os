import { useContext } from "react";
import { LogInIcon } from "lucide-react";
import { EngineContext } from "../../contexts/EngineContext/EngineContext";
import { usePageSceneStore } from "../../PageSceneStore";

// Quiet "you're signed out" affordance shown in the editor for anonymous
// visitors — playground or someone else's scene alike. The actual
// per-action signup CTAs (Save, Generate, Upload) still fire when the
// user clicks those buttons; this chip just sets expectations up front.
export const AnonHintChip = () => {
  const editor = useContext(EngineContext);
  const currentUserToken = usePageSceneStore(s => s.currentUserToken);

  if (currentUserToken) return null;

  const handleClick = () => {
    editor?.adapter.promptSignup?.("hint");
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[3px] border border-ui-panel-border bg-ui-controls px-3 py-1.5 text-xs font-medium text-on-surface/80 transition-colors hover:bg-on-surface/10 hover:text-on-surface"
    >
      <LogInIcon className="opacity-70" />
      Sign up to save
    </button>
  );
};
