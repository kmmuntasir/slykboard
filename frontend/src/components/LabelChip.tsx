import type { Label } from '@/types/label';
import { readableTextColor } from '@/utils/color';

// F14 T7: single-label chip. Inline style for runtime hex (Tailwind JIT cannot
// see dynamic color values); Tailwind classes for layout. WCAG luminance picks
// black or white text so the label is always readable on its background.
interface LabelChipProps {
    label: Label;
    onRemove?: () => void;
}

export function LabelChip({ label, onRemove }: LabelChipProps) {
    const textColor = readableTextColor(label.color);
    return (
        <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: label.color, color: textColor }}
        >
            {label.name}
            {onRemove && (
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={`Remove ${label.name}`}
                    className="ml-0.5 rounded-full px-1 leading-none hover:bg-black/10"
                >
                    ×
                </button>
            )}
        </span>
    );
}
