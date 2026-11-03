import clsx from "clsx";
import type { ChangeKind } from "@sd/ts-client";
import { changeLabel } from "../../../components/modals/PreflightPanel";

/**
 * How a listing row reads under a browsed plan: a row the plan would create
 * is ghosted, one it would delete is struck, one it skips is dimmed, and
 * every touched row carries a badge naming the change.
 */
export function planRowClass(change: ChangeKind | undefined): string | undefined {
	if (!change) return undefined;
	switch (change.type) {
		case "create":
		case "create_directory":
		case "move":
			return "opacity-70 [&_img]:opacity-70";
		case "delete":
			return "opacity-50 line-through decoration-error/70";
		case "skip":
			return "opacity-50";
		default:
			return undefined;
	}
}

export function PlanBadge({
	change,
	className,
}: {
	change: ChangeKind | undefined;
	className?: string;
}) {
	if (!change) return null;
	const tone =
		change.type === "conflict" || (change.type === "delete" && change.last_copy)
			? "bg-error/15 text-error"
			: change.type === "replace" || change.type === "delete"
				? "bg-warning/15 text-warning"
				: change.type === "skip"
					? "bg-app-box text-ink-faint"
					: "bg-accent/15 text-accent";
	return (
		<span
			className={clsx(
				"pointer-events-none rounded px-1 py-px text-[10px] font-medium leading-tight",
				tone,
				className,
			)}
		>
			{changeLabel(change)}
		</span>
	);
}
