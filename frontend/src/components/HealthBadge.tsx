import { useQuery } from '@tanstack/react-query';
import { env } from '@/config/env';

interface HealthResponse {
    status: string;
    service: string;
}

export function HealthBadge() {
    const { data, isError } = useQuery({
        queryKey: ['health'],
        queryFn: async () => {
            // /health is non-enveloped (F03 contract) — raw fetch, not apiFetch.
            const res = await fetch(`${env.apiBaseUrl}/health`);
            if (!res.ok) {
                throw new Error(`Health check failed: ${res.status}`);
            }
            return res.json() as Promise<HealthResponse>;
        },
        staleTime: 30_000,
    });

    const ok = data?.status === 'ok' && !isError;
    return (
        <div className="flex items-center justify-center gap-2 bg-muted px-4 py-1 text-xs">
            <span
                aria-label={ok ? 'Service healthy' : 'Service unhealthy'}
                className={`h-2 w-2 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`}
            />
            <span>{ok ? 'Healthy' : 'Unhealthy'}</span>
        </div>
    );
}
