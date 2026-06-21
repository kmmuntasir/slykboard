import { pathToFileURL } from "node:url"
import cors from "cors"
import express, { type Express } from "express"
import { env } from "./config"

const app: Express = express()

app.use(cors({ origin: env.frontendUrl }))
app.use(express.json())

app.get("/api/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "slykboard-backend",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    })
})

const isMain =
    !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

function start(): void {
    const server = app.listen(env.port, () => {
        console.log(`[slykboard-backend] listening on :${env.port}`)
    })

    server.on("error", (err) => {
        console.error("[slykboard-backend] server error:", err)
        process.exit(1)
    })

    const shutdown = (signal: NodeJS.Signals): void => {
        console.log(`[slykboard-backend] ${signal} received, shutting down`)
        server.close(() => process.exit(0))
    }

    process.on("SIGTERM", shutdown)
    process.on("SIGINT", shutdown)
}

if (isMain) {
    start()
}

export { app }
