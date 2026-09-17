import { useKeyboard, useRenderer } from "@opentui/react"
import { formatInvite, parseInvite, socketUrlForHost, type Message } from "@vibechat/protocol"
import { basename, join } from "node:path"
import { useCallback, useEffect, useRef, useState } from "react"
import { AUTO_STATUS_EMOJI, autoStatusText, runningAgents } from "../autostatus.ts"
import { Client, loadClient } from "../client.ts"
import { saveConfig } from "../config.ts"
import { RequestError } from "../connection.ts"
import { configDir } from "../config.ts"
import { createIdentity, type Identity } from "../identity.ts"
import { createNotifier } from "../notify.ts"
import { createChime } from "../sound.ts"
import { COMMANDS, droppedPath, parseCommand, parsePoll, parseStatus } from "./commands.ts"
import { POLL_DIGITS, clip, humanSize, isMention } from "./format.ts"
import { MessagePicker } from "./MessagePicker.tsx"
import { Onboarding } from "./Onboarding.tsx"
import { Prompt, type PromptHandle, type PromptMode } from "./Prompt.tsx"
import { RoomPicker } from "./RoomPicker.tsx"
import {
  commandLines,
  commit,
  commitImage,
  commitMarkdown,
  commitSticker,
  dividerLines,
  editedLines,
  gapLines,
  hasBlockMarkdown,
  headerLines,
  isGap,
  messageLines,
  reactionLines,
  unreadLines,
  unsentLines,
  type Line,
} from "./scrollback.ts"
import { StatusLine } from "./StatusLine.tsx"
import { TypingLine } from "./TypingLine.tsx"

export interface AppProps {
  identity: Identity | undefined
  version: string
  /** Rows of shell output already on screen above us when we started. */
  preRows: number
  insecure: boolean
  notifications: boolean
  onExit: () => void
}

/** How many messages a room switch replays when nothing from it was printed yet. */
const REPLAY_COUNT = 30
const PICK_COUNT = 12
const IMAGE_COLS = 48
const IMAGE_ROWS = 14

type Picker = "rooms" | "reply" | "edit" | "delete" | "react" | "save"
type SendOpts = NonNullable<Parameters<Client["send"]>[2]>
interface Compose {
  kind: "reply" | "edit" | "react"
  message: Message
}

function relative(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

export function App(props: AppProps) {
  const renderer = useRenderer()
  const [identity, setIdentity] = useState<Identity | undefined>(props.identity)
  const [client, setClient] = useState<Client | undefined>()
  const [tick, setTick] = useState(0)
  const [activeRoomId, setActiveRoomId] = useState<string | undefined>()
  const [picker, setPicker] = useState<Picker | undefined>()
  const [compose, setCompose] = useState<Compose | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  const [links, setLinks] = useState<Record<string, string>>({})
  const [promptMode, setPromptMode] = useState<PromptMode>("text")
  const [promptRows, setPromptRows] = useState(3)
  const [rows, setRows] = useState(renderer.terminalHeight)
  const exitArmed = useRef(0)
  const focused = useRef(true)
  const promptRef = useRef<PromptHandle | null>(null)
  const notifier = useRef(createNotifier(renderer)).current
  const chime = useRef(createChime()).current
  const activeRef = useRef<string | undefined>(undefined)
  activeRef.current = activeRoomId
  const composeRef = useRef<Compose | undefined>(undefined)
  composeRef.current = compose
  /** Rows printed into scrollback so far; the footer shrinks by this much until it reaches its live height. */
  const printed = useRef(0)
  /** Rows of shell output above us; cleared after a resize repaint, which starts from an empty screen. */
  const preRowsRef = useRef(props.preRows)
  const clientRef = useRef<Client | undefined>(undefined)
  const printedSeq = useRef(new Map<string, number>())
  const lastPrinted = useRef(new Map<string, Message>())
  /** What the server never took, in the order it was typed; /retry drains it. */
  const unsent = useRef<{ roomId: string; body: string; opts: SendOpts }[]>([])
  const saveDir = useRef(".")
  /** Scrollback writes happen in order, including the asynchronous ones (markdown, images). */
  const queue = useRef(Promise.resolve())
  const liveRowsRef = useRef(4)

  const flash = useCallback((text: string, ms = 4000) => {
    setNotice(text)
    setTimeout(() => setNotice((n) => (n === text ? undefined : n)), ms)
  }, [])

  const applyFooter = useCallback(
    (extraPrinted = 0) => {
      const total = renderer.terminalHeight
      const wanted = Math.min(total, Math.max(liveRowsRef.current, total - (preRowsRef.current + printed.current + extraPrinted)))
      if (renderer.footerHeight !== wanted) renderer.footerHeight = wanted
    },
    [renderer],
  )

  const width = useCallback(() => Math.max(20, renderer.terminalWidth), [renderer])

  /** Prints lines now; the footer shrinks first so the freed rows are where the lines land. */
  const print = useCallback(
    (lines: Line[]) => {
      queue.current = queue.current.then(() => {
        applyFooter(lines.length)
        printed.current += commit(renderer, lines)
        setTick((t) => t + 1)
      })
    },
    [renderer, applyFooter],
  )

  /** Prints something whose height is only known after rendering (markdown, images, stickers). */
  const printAsync = useCallback(
    (estimate: number, run: () => Promise<number>) => {
      queue.current = queue.current
        .then(async () => {
          applyFooter(estimate)
          printed.current += await run()
          applyFooter()
          setTick((t) => t + 1)
        })
        .catch(() => undefined)
    },
    [renderer, applyFooter],
  )

  const printMessage = useCallback(
    (c: Client, m: Message) => {
      const w = width()
      const prev = lastPrinted.current.get(m.roomId)
      if (prev && isGap(prev, m)) print(gapLines(m.createdAt, w))
      const ctx = { model: c.model, selfId: c.identity.publicKey, selfName: c.identity.name, width: w, prev }
      const block = m.kind === "text" && !m.deletedAt && hasBlockMarkdown(m.body)
      if (block) {
        // Author line first, then the body as a rendered markdown block.
        print(messageLines({ ...m, body: "" }, ctx).filter((l) => l.length > 0))
        printAsync(m.body.split("\n").length, () => commitMarkdown(renderer, m.body))
      } else if (m.kind === "sticker" && !m.deletedAt) {
        print(messageLines(m, ctx))
        printAsync(6, () => commitSticker(renderer, String((m.meta as { text?: string } | undefined)?.text ?? m.body)))
      } else {
        print(messageLines(m, ctx))
      }
      for (const a of m.attachments) {
        if (!a.mime.startsWith("image/")) continue
        const ref = c.fileUrl(m.roomId, a.fileId)
        if (!ref) continue
        printAsync(IMAGE_ROWS, async () => {
          const res = await fetch(ref.url, { headers: { authorization: `Bearer ${ref.session}` } })
          if (!res.ok) return 0
          return commitImage(renderer, new Uint8Array(await res.arrayBuffer()), IMAGE_COLS, IMAGE_ROWS)
        })
      }
      lastPrinted.current.set(m.roomId, m)
      printedSeq.current.set(m.roomId, Math.max(printedSeq.current.get(m.roomId) ?? 0, m.seq))
    },
    [print, printAsync, renderer, width],
  )

  const replayRoom = useCallback(
    (c: Client, roomId: string) => {
      const r = c.model.room(roomId)
      if (!r) return
      const online = [...r.members.keys()].filter((id) => c.model.user(id)?.online).length
      print(dividerLines(c.model.titleOf(roomId), `${r.members.size} members · ${online} online`, width()))
      const since = printedSeq.current.get(roomId) ?? 0
      const fresh = r.messages.filter((m) => m.seq > since)
      const tail = since === 0 ? fresh.slice(-REPLAY_COUNT) : fresh
      if (tail.length < fresh.length) print(commandLines("", [`… ${fresh.length - tail.length} earlier messages not shown · /history prints them`], width()).slice(1))
      // Where the read watermark falls inside the replay, mark it. A boundary on
      // the first line needs no rule: the room divider is already above it.
      const readSeq = r.members.get(c.identity.publicKey)?.lastReadSeq ?? 0
      const firstUnread = tail.findIndex((m) => m.seq > readSeq && m.authorId !== c.identity.publicKey)
      lastPrinted.current.delete(roomId)
      tail.forEach((m, i) => {
        if (i === firstUnread && i > 0) {
          print(unreadLines(tail.slice(i).filter((x) => x.authorId !== c.identity.publicKey).length, width()))
          lastPrinted.current.delete(roomId)
        }
        printMessage(c, m)
      })
      c.markRead(roomId)
    },
    [print, printMessage, width],
  )

  // A resize reflows what the terminal already holds and the footer can no longer
  // be trusted to sit where it was. Erase the screen, start the footer from the
  // top again, and reprint the tail of the room so the view stays readable.
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /** Erases the screen and forgets what was printed; the caller decides what goes back. */
  const resetScreen = useCallback((): boolean => {
    try {
      renderer.resetSplitFooterForReplay()
    } catch {
      return false
    }
    queue.current = Promise.resolve()
    printed.current = 0
    preRowsRef.current = 0
    return true
  }, [renderer])

  const repaintAfterResize = useCallback(() => {
    if (!resetScreen()) return
    const c = clientRef.current
    const roomId = activeRef.current
    if (c && roomId && c.model.room(roomId)) {
      const r = c.model.room(roomId)!
      printedSeq.current.set(roomId, Math.max(0, r.room.lastSeq - REPLAY_COUNT))
      replayRoom(c, roomId)
    } else {
      applyFooter()
    }
  }, [resetScreen, replayRoom, applyFooter])

  /** Clears the screen without reprinting the transcript; the divider says where you are. */
  const clearScreen = useCallback(() => {
    if (!resetScreen()) return
    const c = clientRef.current
    const roomId = activeRef.current
    const r = c && roomId ? c.model.room(roomId) : undefined
    if (!c || !r) return applyFooter()
    const online = [...r.members.keys()].filter((id) => c.model.user(id)?.online).length
    lastPrinted.current.delete(r.room.roomId)
    print(dividerLines(c.model.titleOf(r.room.roomId), `${r.members.size} members · ${online} online`, width()))
  }, [resetScreen, applyFooter, print, width])

  useEffect(() => {
    const onFocus = () => (focused.current = true)
    const onBlur = () => (focused.current = false)
    // The renderer also emits "resize" when the footer height changes; only a
    // change of the terminal itself needs the repaint.
    let last = { w: renderer.terminalWidth, h: renderer.terminalHeight }
    const onResize = () => {
      const w = renderer.terminalWidth
      const h = renderer.terminalHeight
      if (w === last.w && h === last.h) return
      last = { w, h }
      setRows(h)
      if (resizeTimer.current) clearTimeout(resizeTimer.current)
      resizeTimer.current = setTimeout(repaintAfterResize, 150)
    }
    renderer.on("focus", onFocus)
    renderer.on("blur", onBlur)
    renderer.on("resize", onResize)
    return () => {
      renderer.off("focus", onFocus)
      renderer.off("blur", onBlur)
      renderer.off("resize", onResize)
      if (resizeTimer.current) clearTimeout(resizeTimer.current)
    }
  }, [renderer, repaintAfterResize])

  useEffect(() => {
    if (!identity || client) return
    let cancelled = false
    void (async () => {
      const c = await loadClient(identity, configDir(), props.insecure)
      if (cancelled) return
      c.model.on((e) => {
        setTick((t) => t + 1)
        if (e.type === "message") {
          if (e.roomId === activeRef.current) {
            printMessage(c, e.message)
            if (focused.current) c.markRead(e.roomId)
          }
          if (!e.own) {
            const mention = isMention(e.message, c.identity.name)
            if (mention && c.config.sounds) chime.play()
            if (props.notifications && (!focused.current || e.roomId !== activeRef.current || mention)) {
              notifier.notify(c.model.titleOf(e.roomId), `${c.model.nameOf(e.message.authorId)}: ${e.message.body || e.message.kind}`)
            }
          }
        }
        if (e.type === "reaction" && e.on && e.roomId === activeRef.current && e.userId !== identity.publicKey) print(reactionLines(c.model, e.message, e.userId, e.emoji, width()))
        if (e.type === "updated" && e.roomId === activeRef.current) print(editedLines(c.model, e.message, width()))
        if (e.type === "room-removed" && e.roomId === activeRef.current) {
          setActiveRoomId(undefined)
          flash(`you are no longer in that room (${e.reason})`, 6000)
        }
      })
      c.onState((host, state, detail) => {
        setLinks((l) => ({ ...l, [host]: state }))
        if (state === "closed" && detail) flash(`${host}: ${detail}`, 8000)
      })
      const failures = await c.connectAll()
      if (cancelled) return
      const hosts = c.config.hosts
      print(headerLines(props.version, c.identity.name, hosts.length ? hosts.join(" · ") : "/server <host[:port]> · /new <name> · /join <host/TOKEN>"))
      clientRef.current = c
      setClient(c)
      for (const f of failures) flash(`${f.host}: ${f.error}`, 8000)
    })()
    return () => {
      cancelled = true
    }
  }, [identity, client, props.insecure, props.notifications, props.version, notifier, chime, flash, print, printMessage, width])

  useEffect(
    () => () => {
      client?.close()
      chime.dispose()
    },
    [client, chime],
  )

  // Auto status: follow AI coding CLIs running on this machine.
  useEffect(() => {
    if (!client || !client.config.autoStatus) return
    let last = ""
    const check = async () => {
      const text = autoStatusText(await runningAgents())
      if (text === last) return
      last = text
      await client.setStatus(text, text ? AUTO_STATUS_EMOJI : "").catch(() => undefined)
    }
    void check()
    const t = setInterval(() => void check(), 30_000)
    return () => clearInterval(t)
  }, [client, tick && client?.config.autoStatus])

  const lastReplayed = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!client) return
    if (!activeRoomId || !client.model.room(activeRoomId)) {
      const first = client.model.roomList()[0]
      if (first) setActiveRoomId(first.room.roomId)
      return
    }
    if (lastReplayed.current !== activeRoomId) {
      lastReplayed.current = activeRoomId
      replayRoom(client, activeRoomId)
    }
  }, [client, activeRoomId, tick, replayRoom])

  // React state changing does not by itself make the renderer draw a frame, so a
  // message or a member arriving left the footer showing the counts it had at the
  // last keystroke. Ask for one after every render.
  useEffect(() => {
    renderer.requestRender()
  })

  const model = client?.model
  const room = model && activeRoomId ? model.room(activeRoomId) : undefined
  const typing = room && model ? model.typingIn(room.room.roomId) : []
  const pickerRows = picker && model ? Math.min(rows - 4, picker === "rooms" ? model.rooms.size * 2 + 1 : PICK_COUNT + 1) : 0
  const liveRows = (typing.length ? 1 : 0) + pickerRows + promptRows + 1
  liveRowsRef.current = liveRows
  useEffect(() => {
    if (!identity) {
      renderer.footerHeight = Math.max(4, rows)
      return
    }
    applyFooter()
  }, [renderer, identity, rows, liveRows, tick, applyFooter])

  /** Sends, and when the server never took it, says so under the line already printed. */
  const sendMessage = useCallback(
    async (c: Client, roomId: string, body: string, opts: SendOpts = {}) => {
      try {
        await c.send(roomId, body, opts)
      } catch {
        unsent.current.push({ roomId, body, opts })
        print(unsentLines(body, width()))
      }
    },
    [print, width],
  )

  const exit = useCallback(() => {
    client?.close()
    props.onExit()
  }, [client, props])

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      const now = Date.now()
      if (now - exitArmed.current < 2000) return exit()
      exitArmed.current = now
      flash("press Ctrl+C again to quit", 2000)
      return
    }
    if (key.name === "escape") {
      if (picker) setPicker(undefined)
      else if (compose) {
        setCompose(undefined)
        if (compose.kind === "edit") promptRef.current?.setText("")
        flash("cancelled", 1500)
      }
      return
    }
    if (key.ctrl && key.name === "k" && client) setPicker((p) => (p === "rooms" ? undefined : "rooms"))
    if (key.ctrl && key.name === "l") clearScreen()
  })

  const pickable = useCallback(
    (kind: Picker): Message[] => {
      if (!room || !identity) return []
      const mine = (m: Message) => m.authorId === identity.publicKey
      const owner = room.room.ownerId === identity.publicKey
      const base = room.messages.filter((m) => m.seq > 0 && m.kind !== "system" && !m.deletedAt)
      if (kind === "edit") return base.filter((m) => mine(m) && m.kind === "text").slice(-PICK_COUNT)
      if (kind === "delete") return base.filter((m) => mine(m) || owner).slice(-PICK_COUNT)
      if (kind === "save") return base.filter((m) => m.attachments.length > 0).slice(-PICK_COUNT)
      return base.slice(-PICK_COUNT)
    },
    [room, identity],
  )

  const run = useCallback(
    async (text: string) => {
      if (!client || !identity) return
      const model = client.model
      const room = activeRoomId ? model.room(activeRoomId) : undefined
      const out = (command: string, lines: string[]) => print(commandLines(command, lines, width()))
      const memberByName = (q: string) => (room ? [...room.members.keys()].find((id) => model.nameOf(id).toLowerCase() === q.replace(/^@/, "").toLowerCase()) : undefined)
      try {
        const active = composeRef.current
        if (active && !text.startsWith("/")) {
          setCompose(undefined)
          if (!room) return
          if (active.kind === "reply") await sendMessage(client, room.room.roomId, text, { replyTo: active.message.msgId })
          else if (active.kind === "edit") await client.edit(room.room.roomId, active.message.msgId, text)
          else if (active.kind === "react") await client.react(room.room.roomId, active.message.msgId, text.trim().slice(0, 16), true)
          return
        }
        const cmd = parseCommand(text)
        if (!cmd) {
          if (!room) return flash("no room selected: /new <name> or /join <host/TOKEN>")
          // A file dragged into the window arrives as its path; send the file, not the path.
          const dropped = droppedPath(text)
          if (dropped && (await Bun.file(dropped.replace(/^~(?=\/)/, process.env.HOME ?? "~")).exists())) {
            flash("uploading…", 30000)
            const att = await client.upload(room.room.roomId, dropped.replace(/^~(?=\/)/, process.env.HOME ?? "~"))
            await sendMessage(client, room.room.roomId, "", { attachments: [att.fileId] })
            return flash(`sent ${att.name}`)
          }
          await sendMessage(client, room.room.roomId, text)
          return
        }
        switch (cmd.name) {
          case "help":
            return out("/help", [
              ...COMMANDS.map((c) => `/${c.name} ${c.args}`.padEnd(38) + c.description),
              "Enter send · Shift+Enter newline · Ctrl+K rooms · Ctrl+L clear · Esc cancel · Ctrl+C twice quit",
              "drag a file into the window to send it · scroll with your terminal",
            ])
          case "rooms":
            return out(
              "/rooms",
              model.roomList().map((r) => {
                const online = [...r.members.keys()].filter((id) => model.user(id)?.online).length
                return `${r.room.roomId === activeRoomId ? "▶" : " "} ${model.titleOf(r.room.roomId).padEnd(24)} ${String(r.members.size).padStart(2)} members  ${online} online${r.unread ? `  ${r.unread} unread` : ""}  ${r.host}`
              }),
            )
          case "room": {
            const target = model.findRoom(cmd.rest)
            if (!target) return flash(`no room matches "${cmd.rest}"`)
            setActiveRoomId(target.room.roomId)
            return
          }
          case "server": {
            if (!cmd.rest) return out("/server", [`default: ${client.config.defaultHost ?? "none"}`, ...client.config.hosts.map((h) => `${h}${links[h] ? ` (${links[h]})` : ""}`)])
            await client.setDefaultHost(cmd.rest)
            return flash(`default server: ${cmd.rest}`)
          }
          case "new": {
            if (!cmd.rest) return flash("usage: /new <name>")
            const host = client.config.defaultHost
            if (!host) return flash("no server yet: /server <host[:port]> to pick one, or /join a full invite (host/TOKEN)")
            const created = await client.createRoom(host, cmd.rest)
            out(`/new ${cmd.rest}`, [`invite: ${formatInvite(host, created.invite!)}`])
            setActiveRoomId(created.roomId)
            return
          }
          case "join": {
            const inv = parseInvite(cmd.rest)
            if (!inv) return flash("usage: /join <host/TOKEN>")
            const host = inv.host ?? client.config.defaultHost
            if (!host) return flash("this invite has no host and no default server is known; use host/TOKEN")
            const joined = await client.joinRoom(host, inv.token)
            setActiveRoomId(joined.roomId)
            return
          }
          case "invite": {
            if (!room) return flash("no room selected")
            if (room.room.kind === "dm") return flash("direct messages have no invite")
            if (cmd.rest === "reset") {
              const token = await client.resetInvite(room.room.roomId)
              return out("/invite reset", [`new invite: ${formatInvite(room.host, token)} · the old one no longer works`])
            }
            const scheme = socketUrlForHost(room.host, { insecure: props.insecure }).startsWith("ws:") ? "http" : "https"
            return out("/invite", [formatInvite(room.host, room.room.invite ?? ""), `${scheme}://${room.host}/i/${room.room.invite}`])
          }
          case "members": {
            if (!room) return flash("no room selected")
            return out(
              "/members",
              [...room.members.values()].map((m) => {
                const u = model.user(m.userId)
                const status = u?.statusText ? `  ${u.statusEmoji ?? ""} ${u.statusText}`.trimEnd() : ""
                const seen = u && !u.online ? `  (seen ${relative(u.lastSeenAt)})` : ""
                return `${u?.online ? "●" : "○"} ${u?.emoji ? u.emoji + " " : ""}${model.nameOf(m.userId)}${m.userId === room.room.ownerId ? " (owner)" : ""}${status}${seen}`
              }),
            )
          }
          case "history": {
            if (!room) return flash("no room selected")
            const n = Math.min(200, Math.max(1, Number(cmd.rest) || 50))
            const older = await client.loadOlder(room.room.roomId, n)
            if (older.length === 0) return flash("nothing older")
            print(dividerLines(model.titleOf(room.room.roomId), `${older.length} earlier messages`, width()))
            lastPrinted.current.delete(room.room.roomId)
            const ctx = { model, selfId: identity.publicKey, selfName: identity.name, width: width() }
            for (const m of older) {
              print(messageLines(m, { ...ctx, prev: lastPrinted.current.get(m.roomId) }))
              lastPrinted.current.set(m.roomId, m)
            }
            lastPrinted.current.delete(room.room.roomId)
            return
          }
          case "reply":
          case "edit":
          case "delete":
            if (!room) return flash("no room selected")
            if (pickable(cmd.name).length === 0) return flash(cmd.name === "reply" ? "nothing to reply to yet" : `no message of yours to ${cmd.name}`)
            setPicker(cmd.name)
            return
          case "react": {
            if (!room) return flash("no room selected")
            const emoji = cmd.rest.trim()
            if (!emoji) {
              if (pickable("react").length === 0) return flash("nothing to react to yet")
              setPicker("react")
              return
            }
            const target = [...room.messages].reverse().find((m) => m.seq > 0 && m.kind !== "system" && !m.deletedAt && m.authorId !== identity.publicKey)
            if (!target) return flash("nothing to react to yet")
            const mine = target.reactions[emoji]?.includes(identity.publicKey) ?? false
            await client.react(room.room.roomId, target.msgId, emoji.slice(0, 16), !mine)
            return
          }
          case "upload": {
            if (!room) return flash("no room selected")
            if (!cmd.rest) return flash("usage: /upload <path>")
            const path = cmd.rest.replace(/^~(?=\/)/, process.env.HOME ?? "~")
            flash("uploading…", 30000)
            const att = await client.upload(room.room.roomId, path)
            await sendMessage(client, room.room.roomId, "", { attachments: [att.fileId] })
            return flash(`sent ${att.name}`)
          }
          case "sticker":
            if (!room) return flash("no room selected")
            if (!cmd.rest) return flash("usage: /sticker <text>")
            await sendMessage(client, room.room.roomId, cmd.rest.slice(0, 16), { kind: "sticker", meta: { text: cmd.rest.slice(0, 16), font: "block" } })
            return
          case "dm": {
            if (!room) return flash("no room selected")
            const target = memberByName(cmd.rest)
            if (!target || target === identity.publicKey) return flash(`no member named "${cmd.rest}" here`)
            const dm = await client.openDm(room.room.roomId, target)
            setActiveRoomId(dm.roomId)
            return
          }
          case "me":
            if (!room) return flash("no room selected")
            if (!cmd.rest) return flash("usage: /me <action>")
            await sendMessage(client, room.room.roomId, cmd.rest, { kind: "me" })
            return
          case "roll":
            if (!room) return flash("no room selected")
            await sendMessage(client, room.room.roomId, cmd.rest || "1d6", { kind: "roll" })
            return
          case "poll": {
            if (!room) return flash("no room selected")
            const poll = parsePoll(cmd.rest)
            if (typeof poll === "string") return flash(poll)
            await sendMessage(client, room.room.roomId, poll.question, { kind: "poll", meta: { options: poll.options } })
            return
          }
          case "vote": {
            if (!room) return flash("no room selected")
            const n = Number(cmd.rest)
            const poll = [...room.messages].reverse().find((m) => m.kind === "poll" && !m.deletedAt)
            if (!poll) return flash("no poll in this room")
            const options = (poll.meta as { options?: string[] } | undefined)?.options ?? []
            if (!Number.isInteger(n) || n < 1 || n > options.length) return flash(`usage: /vote <1-${options.length}>`)
            const digit = POLL_DIGITS[n - 1]!
            const mine = poll.reactions[digit]?.includes(identity.publicKey) ?? false
            await client.react(room.room.roomId, poll.msgId, digit, !mine)
            return flash(mine ? `vote removed: ${options[n - 1]}` : `voted: ${options[n - 1]}`)
          }
          case "status": {
            if (cmd.rest === "auto" || cmd.rest === "clear") {
              client.config = { ...client.config, autoStatus: cmd.rest === "auto" }
              await saveConfig(client.config, configDir())
              if (cmd.rest === "clear") await client.setStatus("", "")
              setTick((t) => t + 1)
              return flash(cmd.rest === "auto" ? "status follows your AI CLI (checked every 30 s)" : "status cleared")
            }
            const s = parseStatus(cmd.rest)
            client.config = { ...client.config, autoStatus: false }
            await client.setStatus(s.text, s.emoji ?? "")
            return flash(s.text ? `status: ${s.emoji ? s.emoji + " " : ""}${s.text}` : "status cleared")
          }
          case "name": {
            const name = cmd.rest.trim()
            if (name.length < 1 || name.length > 32) return flash("usage: /name <1-32 characters>")
            await client.setProfile({ name })
            setIdentity({ ...identity, name })
            return flash(`you are now ${name}`)
          }
          case "emoji": {
            const emoji = cmd.rest.trim().slice(0, 16)
            await client.setProfile({ emoji })
            return flash(emoji ? `emoji: ${emoji}` : "emoji cleared")
          }
          case "sounds": {
            const on = cmd.rest === "on" ? true : cmd.rest === "off" ? false : undefined
            if (on === undefined) return flash("usage: /sounds on|off")
            client.config = { ...client.config, sounds: on }
            await saveConfig(client.config, configDir())
            if (on) chime.play()
            return flash(on ? "sounds on" : "sounds off")
          }
          case "kick": {
            if (!room) return flash("no room selected")
            const target = memberByName(cmd.rest)
            if (!target) return flash(`no member named "${cmd.rest}"`)
            await client.kick(room.room.roomId, target)
            return flash(`removed ${model.nameOf(target)}`)
          }
          case "transfer": {
            if (!room) return flash("no room selected")
            const target = memberByName(cmd.rest)
            if (!target) return flash(`no member named "${cmd.rest}"`)
            await client.transfer(room.room.roomId, target)
            return flash(`${model.nameOf(target)} now owns this room`)
          }
          case "rename": {
            if (!room) return flash("no room selected")
            if (!cmd.rest) return flash("usage: /rename <name>")
            await client.renameRoom(room.room.roomId, cmd.rest)
            return flash(`renamed to ${cmd.rest}`)
          }
          case "destroy": {
            if (!room) return flash("no room selected")
            if (cmd.rest !== "yes") return flash(`this deletes #${model.titleOf(room.room.roomId)} for everyone · type /destroy yes to confirm`, 8000)
            await client.deleteRoom(room.room.roomId)
            setActiveRoomId(undefined)
            return flash("room deleted")
          }
          case "leave": {
            if (!room) return flash("no room selected")
            const host = room.host
            await client.leaveRoom(room.room.roomId)
            await client.pruneHost(host)
            setActiveRoomId(undefined)
            return flash("left the room")
          }
          case "save": {
            if (!room) return flash("no room selected")
            if (pickable("save").length === 0) return flash("no file has been sent here")
            saveDir.current = cmd.rest.trim() || "."
            setPicker("save")
            return
          }
          case "retry": {
            const pending = unsent.current
            if (pending.length === 0) return flash("nothing to retry")
            unsent.current = []
            for (const u of pending) await sendMessage(client, u.roomId, u.body, u.opts)
            return
          }
          case "clear":
            return clearScreen()
          case "quit":
            return exit()
          default:
            return flash(`unknown command /${cmd.name}; try /help`)
        }
      } catch (e) {
        if (e instanceof RequestError) return flash(`${e.code}: ${e.message}`, 6000)
        flash(e instanceof Error ? e.message : String(e), 6000)
      }
    },
    [client, identity, activeRoomId, flash, exit, links, print, props.insecure, width, pickable, chime, sendMessage, clearScreen],
  )

  const onPickMessage = useCallback(
    async (kind: Picker, m: Message) => {
      setPicker(undefined)
      if (!client || !room) return
      if (kind === "save") {
        const dir = saveDir.current.replace(/^~(?=\/)/, process.env.HOME ?? "~")
        try {
          const written: string[] = []
          for (const a of m.attachments) {
            const ref = client.fileUrl(m.roomId, a.fileId)
            if (!ref) continue
            const res = await fetch(ref.url, { headers: { authorization: `Bearer ${ref.session}` } })
            if (!res.ok) throw new Error(`${a.name}: server said ${res.status}`)
            // The name came off the wire; only its last segment may reach the filesystem.
            const path = join(dir, basename(a.name))
            await Bun.write(path, res)
            written.push(`${path} (${humanSize(a.size)})`)
          }
          print(commandLines("/save", written.length ? written : ["that message carries no file"], width()))
        } catch (e) {
          flash(e instanceof Error ? e.message : String(e), 6000)
        }
        return
      }
      if (kind === "delete") {
        try {
          await client.remove(room.room.roomId, m.msgId)
        } catch (e) {
          flash(e instanceof Error ? e.message : String(e), 6000)
        }
        return
      }
      if (kind === "reply" || kind === "edit" || kind === "react") {
        setCompose({ kind, message: m })
        if (kind === "edit") promptRef.current?.setText(m.body)
        promptRef.current?.focus()
      }
    },
    [client, room, flash],
  )

  if (!identity) {
    return (
      <Onboarding
        onDone={(name) => {
          void createIdentity(name, undefined, configDir()).then(setIdentity)
        }}
      />
    )
  }

  const title = room && model ? model.titleOf(room.room.roomId) : undefined
  const online = room && model ? [...room.members.keys()].filter((id) => model.user(id)?.online).length : 0
  const unreadElsewhere = model ? [...model.rooms.values()].filter((r) => r.room.roomId !== activeRoomId).reduce((n, r) => n + r.unread, 0) : 0
  const offline = Object.entries(links).filter(([, s]) => s !== "online" && s !== "syncing").map(([h]) => h)
  const myLast = room ? [...room.messages].reverse().find((m) => m.authorId === identity.publicKey && m.seq > 0) : undefined
  const seenBy = myLast && room ? [...room.members.values()].filter((mb) => mb.userId !== identity.publicKey && mb.lastReadSeq >= myLast.seq).length : 0
  const where = room
    ? [`#${title}`, `${room.members.size} members`, `${online} online`, myLast && room.members.size > 1 ? `seen by ${seenBy}/${room.members.size - 1}` : "", unreadElsewhere ? `${unreadElsewhere} unread elsewhere` : "", offline.length ? `reconnecting ${offline.join(", ")}` : ""].filter(Boolean).join(" · ")
    : client
      ? "no room · /server <host> · /new <name> · /join <host/TOKEN>"
      : "connecting…"
  const composeHint = compose && model ? `${compose.kind === "reply" ? "↩ replying to" : compose.kind === "edit" ? "✎ editing" : "☺ react to"} ${model.nameOf(compose.message.authorId)}: ${clip(compose.message.body || compose.message.kind, 40)} · Esc cancel` : undefined
  const hint = picker
    ? "↑↓ move · Enter pick · Esc close"
    : (composeHint ??
      (promptMode === "menu" ? "↑↓ select · Tab complete · Enter run · Esc clear" : promptMode === "history" ? "↑↓ history · Enter send" : where))
  const placeholder = compose ? (compose.kind === "react" ? "type an emoji" : compose.kind === "edit" ? "edit your message" : "your reply") : room ? "type a message · / for commands" : "/server <host> to pick a server, then /new or /join"

  return (
    <box flexDirection="column" width="100%" height="100%">
      {typing.length > 0 && model ? <TypingLine names={typing.map((id) => model.nameOf(id))} seed={typing[0]!} /> : null}
      {picker === "rooms" && model ? (
        <box height={pickerRows} flexShrink={0}>
          <RoomPicker
            model={model}
            onPick={(id) => {
              setActiveRoomId(id)
              setPicker(undefined)
            }}
            onClose={() => setPicker(undefined)}
          />
        </box>
      ) : picker && model ? (
        <box height={pickerRows} flexShrink={0}>
          <MessagePicker model={model} messages={pickable(picker)} title={picker === "reply" ? "Reply to" : picker === "edit" ? "Edit" : picker === "delete" ? "Delete" : picker === "save" ? "Save from" : "React to"} onPick={(m) => void onPickMessage(picker, m)} />
        </box>
      ) : null}
      <Prompt ref={promptRef} active={!picker} placeholder={placeholder} onSubmit={(t) => void run(t)} onTyping={() => activeRoomId && client?.typing(activeRoomId)} onMode={setPromptMode} onLayout={setPromptRows} />
      <StatusLine left={hint} right={promptMode === "text" && !picker && !compose ? "/help" : ""} notice={notice} />
    </box>
  )
}
