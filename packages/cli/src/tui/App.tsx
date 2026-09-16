import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/react"
import { formatInvite, parseInvite, socketUrlForHost } from "@vibechat/protocol"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Client, loadClient } from "../client.ts"
import { RequestError } from "../connection.ts"
import { configDir } from "../config.ts"
import { createIdentity, type Identity } from "../identity.ts"
import { createNotifier } from "../notify.ts"
import { COMMANDS, parseCommand, parsePoll, parseStatus } from "./commands.ts"
import { POLL_DIGITS, isMention } from "./format.ts"
import { Header } from "./Header.tsx"
import { Onboarding } from "./Onboarding.tsx"
import { Prompt, type PromptHandle, type PromptMode } from "./Prompt.tsx"
import { RoomPicker } from "./RoomPicker.tsx"
import { StatusLine } from "./StatusLine.tsx"
import { theme } from "./theme.ts"
import { Transcript } from "./Transcript.tsx"

export interface AppProps {
  identity: Identity | undefined
  version: string
  insecure: boolean
  notifications: boolean
  onExit: () => void
}

export function App(props: AppProps) {
  const renderer = useRenderer()
  const [identity, setIdentity] = useState<Identity | undefined>(props.identity)
  const [client, setClient] = useState<Client | undefined>()
  const [tick, setTick] = useState(0)
  const [activeRoomId, setActiveRoomId] = useState<string | undefined>()
  const [picker, setPicker] = useState(false)
  const [info, setInfo] = useState<string[]>([])
  const [notice, setNotice] = useState<string | undefined>()
  const [links, setLinks] = useState<Record<string, string>>({})
  const [promptMode, setPromptMode] = useState<PromptMode>("text")
  const exitArmed = useRef(0)
  const focused = useRef(true)
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const promptRef = useRef<PromptHandle | null>(null)
  const notifier = useMemo(() => createNotifier(renderer), [renderer])
  const activeRef = useRef<string | undefined>(undefined)
  activeRef.current = activeRoomId

  const flash = useCallback((text: string, ms = 4000) => {
    setNotice(text)
    setTimeout(() => setNotice((n) => (n === text ? undefined : n)), ms)
  }, [])

  // Terminal focus tracking, used to mute notifications while you are looking.
  useEffect(() => {
    const onFocus = () => (focused.current = true)
    const onBlur = () => (focused.current = false)
    renderer.on("focus", onFocus)
    renderer.on("blur", onBlur)
    return () => {
      renderer.off("focus", onFocus)
      renderer.off("blur", onBlur)
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
        if (e.type === "message" && !e.own && props.notifications) {
          const mention = isMention(e.message, identity.name)
          if (!focused.current || e.roomId !== activeRef.current || mention) {
            const who = c.model.nameOf(e.message.authorId)
            notifier.notify(c.model.titleOf(e.roomId), `${who}: ${e.message.body || e.message.kind}`)
          }
        }
        if (e.type === "room-removed" && e.roomId === activeRef.current) setActiveRoomId(undefined)
      })
      c.onState((host, state, detail) => {
        setLinks((l) => ({ ...l, [host]: state }))
        if (state === "closed" && detail) flash(`${host}: ${detail}`, 8000)
      })
      setClient(c)
      const failures = await c.connectAll()
      for (const f of failures) flash(`${f.host}: ${f.error}`, 8000)
    })()
    return () => {
      cancelled = true
    }
  }, [identity, client, props.insecure, props.notifications, notifier, flash])

  useEffect(() => () => client?.close(), [client])

  // Pick a room when none is active; mark the active room read as messages arrive.
  useEffect(() => {
    if (!client) return
    if (!activeRoomId || !client.model.room(activeRoomId)) {
      const first = client.model.roomList()[0]
      if (first) setActiveRoomId(first.room.roomId)
      return
    }
    if (focused.current) client.markRead(activeRoomId)
  }, [client, activeRoomId, tick])

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
      if (picker) setPicker(false)
      else if (info.length) setInfo([])
      return
    }
    if (key.ctrl && key.name === "k" && client) {
      setPicker((p) => !p)
      return
    }
    if (key.name === "pageup" || key.name === "pagedown") {
      const box = scrollRef.current
      if (!box) return
      const page = Math.max(1, box.height - 2)
      box.scrollBy(key.name === "pageup" ? -page : page)
      if (key.name === "pageup" && box.scrollTop <= 0 && client && activeRoomId) void client.loadOlder(activeRoomId).catch(() => undefined)
    }
  })

  const run = useCallback(
    async (text: string) => {
      if (!client) return
      setInfo([])
      const cmd = parseCommand(text)
      const model = client.model
      const room = activeRoomId ? model.room(activeRoomId) : undefined
      try {
        if (!cmd) {
          if (!room) return flash("no room selected: /new <name> or /join <host/TOKEN>")
          await client.send(room.room.roomId, text)
          return
        }
        switch (cmd.name) {
          case "help":
            return setInfo([
              ...COMMANDS.map((c) => `/${c.name} ${c.args}`.padEnd(30) + c.description),
              "",
              "Enter send · Shift+Enter newline · Ctrl+K rooms · PageUp/PageDown scroll · Esc close · Ctrl+C twice quit",
            ])
          case "rooms":
            return setInfo(
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
            if (!cmd.rest) return setInfo([`default server: ${client.config.defaultHost ?? "none"}`, ...client.config.hosts.map((h) => `  ${h}${links[h] ? ` (${links[h]})` : ""}`)])
            await client.setDefaultHost(cmd.rest)
            return flash(`default server: ${cmd.rest}`)
          }
          case "new": {
            if (!cmd.rest) return flash("usage: /new <name>")
            const host = client.config.defaultHost
            if (!host) return flash("no server yet: /server <host[:port]> to pick one, or /join a full invite (host/TOKEN)")
            const created = await client.createRoom(host, cmd.rest)
            setActiveRoomId(created.roomId)
            return flash(`created ${created.name} · invite ${formatInvite(host, created.invite!)}`, 15000)
          }
          case "join": {
            const inv = parseInvite(cmd.rest)
            if (!inv) return flash("usage: /join <host/TOKEN>")
            const host = inv.host ?? client.config.defaultHost
            if (!host) return flash("this invite has no host and no default server is known; use host/TOKEN")
            const joined = await client.joinRoom(host, inv.token)
            setActiveRoomId(joined.roomId)
            return flash(`joined ${joined.name}`)
          }
          case "invite": {
            if (!room) return flash("no room selected")
            if (!room.room.invite) return flash("direct messages have no invite")
            const scheme = socketUrlForHost(room.host, { insecure: props.insecure }).startsWith("ws:") ? "http" : "https"
            return setInfo([`invite for ${model.titleOf(room.room.roomId)}:`, `  ${formatInvite(room.host, room.room.invite)}`, `  ${scheme}://${room.host}/i/${room.room.invite}`])
          }
          case "members": {
            if (!room) return flash("no room selected")
            return setInfo(
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
    [client, activeRoomId, identity, flash, exit, links, props.insecure],
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

  const model = client?.model
  const room = model && activeRoomId ? model.room(activeRoomId) : undefined
  const title = room && model ? model.titleOf(room.room.roomId) : undefined
  const online = room && model ? [...room.members.keys()].filter((id) => model.user(id)?.online).length : 0
  const unreadElsewhere = model ? [...model.rooms.values()].filter((r) => r.room.roomId !== activeRoomId).reduce((n, r) => n + r.unread, 0) : 0
  const offline = Object.entries(links).filter(([, s]) => s !== "online" && s !== "syncing").map(([h]) => h)
  const roomCount = model ? model.rooms.size : 0
  const where = room ? `#${title} · ${online} online` : client ? "no rooms yet" : "connecting…"
  const detail = room
    ? [room.host, `${roomCount} room${roomCount === 1 ? "" : "s"}`, unreadElsewhere ? `${unreadElsewhere} unread elsewhere` : "", offline.length ? `reconnecting ${offline.join(", ")}` : ""].filter(Boolean).join(" · ")
    : "/server <host[:port]> · /new <name> · /join <host/TOKEN>"
  const hint = picker
    ? "↑↓ move · Enter pick · Esc close"
    : info.length
      ? "Esc close"
      : promptMode === "menu"
        ? "↑↓ select · Tab complete · Enter run · Esc clear"
        : promptMode === "history"
          ? "↑↓ history · Enter send"
          : "Enter send · ⇧Enter newline · Ctrl+K rooms · PageUp older"

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header version={props.version} name={identity.name} where={where} detail={detail} />
      {picker && model ? (
        <RoomPicker
          model={model}
          onPick={(id) => {
            setActiveRoomId(id)
            setPicker(false)
          }}
          onClose={() => setPicker(false)}
        />
      ) : model ? (
        <Transcript model={model} room={room} selfId={identity.publicKey} scrollRef={scrollRef} version={tick} />
      ) : (
        <box flexGrow={1} flexShrink={1} />
      )}
      {info.length > 0 ? (
        <box flexDirection="column" paddingLeft={2} paddingRight={2} flexShrink={0}>
          {info.map((line, i) => (
            <text key={i} fg={theme.self}>
              {line || " "}
            </text>
          ))}
        </box>
      ) : null}
      <Prompt
        ref={promptRef}
        active={!picker}
        placeholder={room ? "type a message · / for commands" : "/server <host> to pick a server, then /new or /join"}
        onSubmit={(t) => void run(t)}
        onTyping={() => activeRoomId && client?.typing(activeRoomId)}
        onMode={setPromptMode}
      />
      <StatusLine left={hint} right="/help" notice={notice} />
    </box>
  )
}
