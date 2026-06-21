import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
    const cases = [{ name: 'renders title', text: 'Slykboard' }];

    cases.forEach(({ name, text }) => {
        it(name, () => {
            render(<App />);
            expect(screen.getByText(text)).toBeInTheDocument();
        });
    });
});
