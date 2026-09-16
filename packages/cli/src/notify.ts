/**
 * Desktop notifications. The renderer handles terminals that speak a
 * notification escape sequence; everything else falls back to the OS.
 */
export interface Notifier {
  notify(title: string, body: string): void
}

const enc = (s: string) => s.replace(/[\r\n]+/g, " ").slice(0, 200)

export function createNotifier(renderer: { triggerNotification(message: string, title?: string): boolean }): Notifier {
  return {
    notify(title, body) {
      if (renderer.triggerNotification(enc(body), enc(title))) return
      void osNotify(enc(title), enc(body))
    },
  }
}

async function osNotify(title: string, body: string): Promise<void> {
  try {
    if (process.platform === "darwin") {
      const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`
      await Bun.spawn(["osascript", "-e", script], { stdout: "ignore", stderr: "ignore" }).exited
      return
    }
    if (process.platform === "linux") {
      if (!Bun.which("notify-send")) return
      await Bun.spawn(["notify-send", title, body], { stdout: "ignore", stderr: "ignore" }).exited
      return
    }
    if (process.platform === "win32") {
      const ps = [
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
        "$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
        `$n = $t.GetElementsByTagName('text'); $n.Item(0).AppendChild($t.CreateTextNode(${psq(title)})) | Out-Null; $n.Item(1).AppendChild($t.CreateTextNode(${psq(body)})) | Out-Null`,
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('vibechat').Show([Windows.UI.Notifications.ToastNotification]::new($t))",
      ].join("; ")
      await Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], { stdout: "ignore", stderr: "ignore" }).exited
    }
  } catch {
    // notifications are best-effort
  }
}

function psq(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}
