import clsx from 'clsx';

// design:content: tag colours are user data; a tag made without one shows the default swatch.
const DEFAULT_TAG_COLOR = '#3B82F6';

/** A tag's color, or the default blue for a tag made without one. */
export function tagColor(tag: { color?: string | null }): string {
	return tag.color || DEFAULT_TAG_COLOR;
}

interface TagDotProps {
	color: string;
	tooltip?: string;
	onClick?: (e: React.MouseEvent) => void;
	/** `sm` (6px) sits among card metadata; `md` (8px) fills an icon slot. */
	size?: 'sm' | 'md';
	className?: string;
}

/**
 * Small colored circle indicator for tag visualization
 * Used in FileCard, the sidebar, and compact layouts
 */
export function TagDot({ color, tooltip, onClick, size = 'sm', className }: TagDotProps) {
	const Component = onClick ? 'button' : 'span';

	return (
		<Component
			className={clsx(
				'shrink-0 rounded-full',
				size === 'sm' ? 'size-1.5' : 'size-2',
				onClick && 'hover:scale-125 transition-transform cursor-pointer',
				className
			)}
			style={{ backgroundColor: color }}
			title={tooltip}
			onClick={onClick}
		/>
	);
}
