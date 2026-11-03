import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Honours the OS reduced-motion setting for every framer-motion animation below it: transform and layout
 * animations are skipped, opacity fades are kept (the M3 reduced-motion rule). Mounted at each app root.
 */
export function MotionPreferences({ children }: { children: ReactNode }) {
	return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
