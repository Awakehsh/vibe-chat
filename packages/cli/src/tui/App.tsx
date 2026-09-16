import { useKeyboard, useRenderer } from "@opentui/react"
import { formatInvite, parseInvite, socketUrlForHost, type Message } from "@vibechat/protocol"
import { useCallback, useEffect, useRef, useState } from "react"
import { Client, loadClient } from "../client.ts"
import { RequestError } from "../connection.ts"
import { configDir } from "../config.ts"
import { createIdentity, type Identity } from "../identity.ts"
import { createNotifier } from "../notify.ts"
import { COMMANDS, parseCommand, parsePoll, parseStatus } from "./commands.ts"
import { POLL_DIGITS, isMention } from "./format.ts"
import { Onboarding } from "./Onboarding.tsx"
import { Prompt, type PromptHandle, type PromptMode } from "./Prompt.tsx"
import { RoomPicker } from "./RoomPicker.tsx"
import { commandLines, commit, dividerLines, editedLines, headerLines, messageLines, reactionLines } from "./scrollback.ts"
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

export function App(props: AppProps) {
  const renderer = useRenderer()
  const [identity, setIdentity] = useState<Identity | undefined>(props.identity)
  const [client, setClient] = useState<Client | undefined>()
  const [tick, setTick] = useState(0)
  const [activeRoomId, setActiveRoomId] = useState<string | undefined>()
  const [picker, setPicker] = useState(false)
  const [notice, setNotice] = useState<string | undefined>()
  const [links, setLinks] = useState<Record<string, string>>({})
  const [promptMode, setPromptMode] = useState<PromptMode>("text")
  const [promptRows, setPromptRows] = useState(3)
  const [rows, setRows] = useState(renderer.terminalHeight)
  const exitArmed = useRef(0)
  const focused = useRef(true)
  const promptRef = useRef<PromptHandle | null>(null)
  const notifier = useRef(createNotifier(renderer)).current
  const activeRef = useRef<string | undefined>(undefined)
  activeRef.current = activeRoomId
  /** Rows printed into scrollback so far; the footer shrinks by this much until it reaches its live height. */
  const printed = useRef(0)
  /** Per room: the seq of the last message printed, and the last message printed (for run grouping). */
  const printedSeq = useRef(new Map<string, number>())
  const lastPrinted = useRef(new Map<string, Message>())

  const flash = useCallback((text: string, ms = 4000) => {
    setNotice(text)
    setTimeout(() => setNotice((n) => (n === text ? undefined : n)), ms)
  }, [])

  /** Rows the live region needs right now; kept in a ref so print() can size the footer synchronously. */
  const liveRowsRef = useRef(4)

  /** Footer = live rows, or more while the screen is not yet full so the live region sits under what was printed. */
  const applyFooter = useCallback(
    (extraPrinted = 0) => {
      const total = renderer.terminalHeight
      const wanted = Math.min(total, Math.max(liveRowsRef.current, total - (props.preRows + printed.current + extraPrinted)))
      if (renderer.footerHeight !== wanted) renderer.footerHeight = wanted
    },
    [renderer, props.preRows],
  )

  const print = useCallback(
    (lines: Parameters<typeof commit>[1]) => {
      // Shrink the footer first so the freed rows are where the new lines land.
      applyFooter(lines.length)
      printed.current += commit(renderer, lines)
      setTick((t) => t + 1)
    },
    [renderer, applyFooter],
  )

  const width = () => Math.max(20, renderer.terminalWidth)

  const printMessage = useCallback(
    (c: Client, m: Message) => {
      const ctx = { model: c.model, selfId: c.identity.publicKey, selfName: c.identity.name, width: width(), prev: lastPrinted.current.get(m.roomId) }
      print(messageLines(m, ctx))
      lastPrinted.current.set(m.roomId, m)
      printedSeq.current.set(m.roomId, Math.max(printedSeq.current.get(m.roomId) ?? 0, m.seq))
    },
    [print],
  )

  /** Divider plus whatever this room has that was not printed yet. */
  const replayRoom = useCallback(
    (c: Client, roomId: string) => {
      const r = c.model.room(roomId)
      if (!r) return
      const online = [...r.members.keys()].filter((id) => c.model.user(id)?.online).length
      print(dividerLines(c.model.titleOf(roomId), `${r.members.size} members · ${online} online`, width()))
      const since = printedSeq.current.get(roomId) ?? 0
      const fresh = r.messages.filter((m) => m.seq > since)
      const tail = since === 0 ? fresh.slice(-REPLAY_COUNT) : fresh
      if (tail.length < fresh.length) print([[{ text: `  … ${fresh.length - tail.length} older messages not shown`, attributes: 0 } as never]])
      lastPrinted.current.delete(roomId)
      for (const m of tail) printMessage(c, m)
      c.markRead(roomId)
    },
    [print, printMessage],
  )

  // Terminal focus and size.
  useEffect(() => {
    const onFocus = () => (focused.current = true)
    const onBlur = () => (focused.current = false)
    const onResize = () => setRows(renderer.terminalHeight)
    renderer.on("focus", onFocus)
    renderer.on("blur", onBlur)
    renderer.on("resize", onResize)
    return () => {
      renderer.off("focus", onFocus)
      renderer.off("blur", onBlur)
      renderer.off("resize", onResize)
    }
  }, [renderer])

  // Create the client once we have an identity; connect to every known host.
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
          if (!e.own && props.notifications) {
            const mention = isMention(e.message, identity.name)
            if (!focused.current || e.roomId !== activeRef.current || mention) {
              notifier.notify(c.model.titleOf(e.roomId), `${c.model.nameOf(e.message.authorId)}: ${e.message.body || e.message.kind}`)
            }
          }
        }
        if (e.type === "reaction" && e.on && e.roomId === activeRef.current && e.userId !== identity.publicKey) print(reactionLines(c.model, e.message, e.userId, e.emoji, width()))
        if (e.type === "updated" && e.roomId === activeRef.current) print(editedLines(c.model, e.message, width()))
        if (e.type === "room-removed" && e.roomId === activeRef.current) setActiveRoomId(undefined)
      })
      c.onState((host, state, detail) => {
        setLinks((l) => ({ ...l, [host]: state }))
        if (state === "closed" && detail) flash(`${host}: ${detail}`, 8000)
      })
      const failures = await c.connectAll()
      if (cancelled) return
      // Welcome header first, then the room replay that the state change below triggers.
      const hosts = c.config.hosts
      print(headerLines(props.version, c.identity.name, hosts.length ? hosts.join(" · ") : "/server <host[:port]> · /new <name> · /join <host/TOKEN>"))
      setClient(c)
      for (const f of failures) flash(`${f.host}: ${f.error}`, 8000)
    })()
    return () => {
      cancelled = true
    }
  }, [identity, client, props.insecure, props.notifications, props.version, notifier, flash, print, printMessage])

  useEffect(() => () => client?.close(), [client])

  // Pick a room when none is active; replay when the active room changes.
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

  // The live region: typing line, prompt (with menu), status. It sits right under
  // what has been printed until the screen is full, then stays at the bottom.
  const model = client?.model
  const room = model && activeRoomId ? model.room(activeRoomId) : undefined
  const typing = room && model ? model.typingIn(room.room.roomId) : []
  const pickerRows = picker && model ? Math.min(rows - 4, model.rooms.size * 2 + 1) : 0
  const liveRows = (typing.length ? 1 : 0) + pickerRows + promptRows + 1
  liveRowsRef.current = liveRows
  useEffect(() => {
    if (!identity) {
      renderer.footerHeight = Math.max(4, rows)
      return
    }
    applyFooter()
  }, [renderer, identity, rows, liveRows, tick, applyFooter])

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
    if (key.name === "escape" && picker) {
      setPicker(false)
      return
    }
    if (key.ctrl && key.name === "k" && client) setPicker((p) => !p)
  })

  const run = useCallback(
    async (text: string) => {
      if (!client) return
      const cmd = parseCommand(text)
      const model = client.model
      const room = activeRoomId ? model.room(activeRoomId) : undefined
      const out = (command: string, lines: string[]) => print(commandLines(command, lines, width()))
      try {
        if (!cmd) {
          if (!room) return flash("no room selected: /new <name> or /join <host/TOKEN>")
          await client.send(room.room.roomId, text)
          return
        }
        switch (cmd.name) {
          case "help":
            return out("/help", [
              ...COMMANDS.map((c) => `/${c.name} ${c.args}`.padEnd(30) + c.description),
              "Enter send · Shift+Enter newline · Ctrl+K rooms · Esc close · Ctrl+C twice quit · scroll with your terminal",
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
            if (!room.room.invite) return flash("direct messages have no invite")
            const scheme = socketUrlForHost(room.host, { insecure: props.insecure }).startsWith("ws:") ? "http" : "https"
            return out("/invite", [formatInvite(room.host, room.room.invite), `${scheme}://${room.host}/i/${room.room.invite}`])
          }
          case "members": {
            if (!room) return flash("no room selected")
            return out(
              "/members",
              [...room.members.values()].map((m) => {
                const u = model.user(m.userId)
                const status = u?.statusText ? `  ${u.statusEmoji ?? ""} ${u.statusText}`.trimEnd() : ""
                return `${u?.online ? "●" : "○"} ${model.nameOf(m.userId)}${m.userId === room.room.ownerId ? " (owner)" : ""}${status}`
              }),
            )
          }
          case "dm": {
            if (!room) return flash("no room selected")
            const q = cmd.rest.replace(/^@/, "").toLowerCase()
            const target = [...room.members.keys()].find((id) => id !== identity!.publicKey && model.nameOf(id).toLowerCase() === q)
            if (!target) return flash(`no member named "${cmd.rest}" here`)
            const dm = await client.openDm(room.room.roomId, target)
            setActiveRoomId(dm.roomId)
            return
          }
          case "me":
            if (!room) return flash("no room selected")
            if (!cmd.rest) return flash("usage: /me <action>")
            await client.send(room.room.roomId, cmd.rest, { kind: "me" })
            return
          case "roll":
            if (!room) return flash("no room selected")
            await client.send(room.room.roomId, cmd.rest || "1d6", { kind: "roll" })
            return
          case "poll": {
            if (!room) return flash("no room selected")
            const poll = parsePoll(cmd.rest)
            if (typeof poll === "string") return flash(poll)
            await client.send(room.room.roomId, poll.question, { kind: "poll", meta: { options: poll.options } })
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
            const mine = poll.reactions[digit]?.includes(identity!.publicKey) ?? false
            await client.react(room.room.roomId, poll.msgId, digit, !mine)
            return flash(mine ? `vote removed: ${options[n - 1]}` : `voted: ${options[n - 1]}`)
          }
          case "react": {
            if (!room) return flash("no room selected")
            const emoji = cmd.rest.trim()
            if (!emoji || emoji.length > 16) return flash("usage: /react <emoji>")
            const target = [...room.messages].reverse().find((m) => m.seq > 0 && m.kind !== "system" && !m.deletedAt && m.authorId !== identity!.publicKey)
            if (!target) return flash("nothing to react to yet")
            const mine = target.reactions[emoji]?.includes(identity!.publicKey) ?? false
            await client.react(room.room.roomId, target.msgId, emoji, !mine)
            return
          }
          case "status": {
            const s = parseStatus(cmd.rest)
            await client.setStatus(s.text, s.emoji ?? "")
            return flash(s.text ? `status: ${s.emoji ? s.emoji + " " : ""}${s.text}` : "status cleared")
          }
          case "leave": {
            if (!room) return flash("no room selected")
            const host = room.host
            await client.leaveRoom(room.room.roomId)
            await client.pruneHost(host)
            setActiveRoomId(undefined)
            return flash("left the room")
          }
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
    [client, activeRoomId, identity, flash, exit, links, print, props.insecure],
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
  const where = room
    ? [`#${title}`, `${online} online`, unreadElsewhere ? `${unreadElsewhere} unread elsewhere` : "", offline.length ? `reconnecting ${offline.join(", ")}` : ""].filter(Boolean).join(" · ")
    : client
      ? "no room · /server <host> · /new <name> · /join <host/TOKEN>"
      : "connecting…"
  const hint = picker
    ? "↑↓ move · Enter pick · Esc close"
    : promptMode === "menu"
      ? "↑↓ select · Tab complete · Enter run · Esc clear"
      : promptMode === "history"
        ? "↑↓ history · Enter send"
        : where

  return (
    <box flexDirection="column" width="100%" height="100%">
      {typing.length > 0 && model ? <TypingLine names={typing.map((id) => model.nameOf(id))} seed={typing[0]!} /> : null}
      {picker && model ? (
        <box height={pickerRows} flexShrink={0}>
          <RoomPicker
            model={model}
            onPick={(id) => {
              setActiveRoomId(id)
              setPicker(false)
            }}
            onClose={() => setPicker(false)}
          />
        </box>
      ) : null}
      <Prompt
        ref={promptRef}
        active={!picker}
        placeholder={room ? "type a message · / for commands" : "/server <host> to pick a server, then /new or /join"}
        onSubmit={(t) => void run(t)}
        onTyping={() => activeRoomId && client?.typing(activeRoomId)}
        onMode={setPromptMode}
        onLayout={setPromptRows}
      />
      <StatusLine left={hint} right={promptMode === "text" && !picker ? "/help" : ""} notice={notice} />
    </box>
  )
}
