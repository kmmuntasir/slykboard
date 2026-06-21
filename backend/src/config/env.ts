export interface Config {
    port: number
    frontendUrl: string
    nodeEnv: string
    databaseUrl: string
}

export const env: Readonly<Config> = Object.freeze({
    port: Number(process.env.PORT ?? 3000),
    frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
    nodeEnv: process.env.NODE_ENV ?? "development",
    databaseUrl: process.env.DATABASE_URL ?? "",
})
