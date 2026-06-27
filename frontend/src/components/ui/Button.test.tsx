import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { Button, type ButtonVariant, type ButtonSize } from './Button';

describe('Button', () => {
    const variants: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'destructive', 'outline'];
    const sizes: ButtonSize[] = ['sm', 'md', 'lg'];

    // Table-driven variant × size matrix — assert token classes present.
    for (const variant of variants) {
        for (const size of sizes) {
            it(`renders variant=${variant} size=${size} as role=button`, () => {
                render(
                    <Button variant={variant} size={size}>
                        Click
                    </Button>,
                );
                const btn = screen.getByRole('button', { name: 'Click' });
                expect(btn).toBeInTheDocument();
                // Spot-check a token per variant (jsdom can't compute color).
                if (variant === 'primary') expect(btn.className).toContain('bg-primary');
                if (variant === 'destructive') expect(btn.className).toContain('bg-destructive');
                // Spot-check padding per size (one padding per size — kills §2.5 drift).
                if (size === 'sm') expect(btn.className).toContain('px-3 py-1.5');
                if (size === 'lg') expect(btn.className).toContain('px-5 py-2.5');
            });
        }
    }

    it('defaults to variant=primary size=md', () => {
        render(<Button>X</Button>);
        const btn = screen.getByRole('button');
        expect(btn.className).toContain('bg-primary');
        expect(btn.className).toContain('px-4 py-2');
    });

    it('defaults type to button', () => {
        render(<Button>X</Button>);
        expect(screen.getByRole('button').getAttribute('type')).toBe('button');
    });

    it('forwards type/disabled/form rest props', () => {
        render(
            <Button type="submit" disabled form="my-form">
                X
            </Button>,
        );
        const btn = screen.getByRole('button');
        expect(btn.getAttribute('type')).toBe('submit');
        expect(btn).toBeDisabled();
        expect(btn.getAttribute('form')).toBe('my-form');
    });

    it('forwards ref', () => {
        const ref = createRef<HTMLButtonElement>();
        render(<Button ref={ref}>X</Button>);
        expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    });

    it('merges className (consumer override via tailwind-merge)', () => {
        render(<Button className="px-10">X</Button>);
        // tailwind-merge: consumer px-10 wins over size default px-4.
        expect(screen.getByRole('button').className).toContain('px-10');
        expect(screen.getByRole('button').className).not.toContain('px-4');
    });
});
