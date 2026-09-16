#!/usr/bin/env node
// Launcher: finds the platform package that npm installed as an optional
// dependency and runs the compiled binary inside it. No Bun needed.
"use strict"
const { spawnSync } = require("node:child_process")
const path = require("node:path")

const targets = {
  "darwin-arm64": "vibe-chat-darwin-arm64",
  "darwin-x64": "vibe-chat-darwin-x64",
  "linux-x64": "vibe-chat-linux-x64",
  "linux-arm64": "vibe-chat-linux-arm64",
  "win32-x64": "vibe-chat-windows-x64",
}

function locate() {
  if (process.env.VIBECHAT_BINARY) return process.env.VIBECHAT_BINARY
  const key = `${process.platform}-${process.arch}`
  const pkg = targets[key]
  if (!pkg) {
    console.error(`vibechat: no prebuilt binary for ${key}. Build from source: https://github.com/Awakehsh/vibe-chat`)
    process.exit(1)
  }
  const file = process.platform === "win32" ? "vibechat.exe" : "vibechat"
  try {
    return require.resolve(`${pkg}/bin/${file}`)
  } catch {
    console.error(`vibechat: the platform package "${pkg}" is missing. Reinstall with: npm install -g vibe-chat`)
    process.exit(1)
  }
}

const result = spawnSync(locate(), process.argv.slice(2), { stdio: "inherit", windowsHide: false })
if (result.error) {
  console.error(`vibechat: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status === null ? 1 : result.status)
