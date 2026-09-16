import { startServer } from "./server.ts"

const port = Number(process.env.VIBECHAT_PORT ?? 7788)
const dataDir = process.env.VIBECHAT_DATA_DIR ?? "./data"
await startServer({ port, dataDir })
