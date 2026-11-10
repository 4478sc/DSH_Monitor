#!/usr/bin/env python3
"""dsh-attention-toast: Linux desktop toast host (GTK3 / XWayland).

Reads one JSON command per line on stdin, writes JSON events on stdout.
Commands: show / close / close-all / config / preview / ping / shutdown
"""
import sys, os, json, glob, time, subprocess

DISPLAY = os.environ.get("DISPLAY") or ":0"
if not os.environ.get("XAUTHORITY"):
    for cand in glob.glob("/run/user/%d/.mutter-Xwaylandauth.*" % os.getuid()) + \
                [os.path.expanduser("~/.Xauthority")]:
        if os.path.exists(cand):
            os.environ["XAUTHORITY"] = cand
            break
os.environ.setdefault("GDK_BACKEND", "x11")

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gtk, Gdk, GLib, Pango

MARGIN = 20
GAP = 10

DEFAULT_CONFIG = {
    "width": 340,
    "durationMs": 8000,
    "maxVisible": 3,
    "locale": "zh",
    "colors": {
        "completed": {"bg": "#12351f", "fg": "#e6f4ea", "accent": "#2ea043"},
        "failed":    {"bg": "#3a1518", "fg": "#fbe9ea", "accent": "#d1242f"},
        "question":  {"bg": "#241a3d", "fg": "#efe9ff", "accent": "#8250df"},
        "permission":{"bg": "#3a2a10", "fg": "#fff4e0", "accent": "#bf8700"},
        "sidelinedone": {"bg": "#0d2a33", "fg": "#e3f6fb", "accent": "#1f8fb0"},
    },
}

KIND_LABEL = {
    "zh": {"completed": "任务完成", "failed": "任务出错", "question": "收到提问",
           "permission": "等待审批", "sidelinedone": "支线汇总"},
    "en": {"completed": "Task completed", "failed": "Task failed", "question": "Question",
           "permission": "Approval needed", "sidelinedone": "Side-line batch"},
}

CSS = b"""
#dsh-toast { background: transparent; }
#dsh-toast .card { border-radius: 14px; padding: 0; }
#dsh-toast .accent { border-radius: 14px 0 0 14px; }
#dsh-toast .title { font-size: 13px; font-weight: 700; }
#dsh-toast .body { font-size: 12px; }
#dsh-toast .kicker { font-size: 10px; font-weight: 700; letter-spacing: .08em; }
#dsh-toast .close { padding: 0; margin: 0; min-width: 18px; min-height: 18px; border: none;
                    background: transparent; box-shadow: none; }
#dsh-toast .close:hover { background: rgba(255,255,255,.12); border-radius: 9px; }
"""


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class Toast:
    def __init__(self, host, payload):
        self.host = host
        self.id = str(payload.get("id") or ("t%d" % int(time.time() * 1000)))
        self.kind = payload.get("kind") if payload.get("kind") in KIND_LABEL["zh"] else "completed"
        self.title = str(payload.get("title") or "")
        self.text = str(payload.get("text") or "")
        self.kicker = payload.get("kicker")
        self.duration = int(payload.get("durationMs") or host.config["durationMs"])
        self.timer = None
        self.hovered = False
        self.closing = False
        self.height = 0

        colors = host.config["colors"].get(self.kind) or host.config["colors"]["completed"]
        bg, fg, accent = colors["bg"], colors["fg"], colors["accent"]

        win = Gtk.Window(type=Gtk.WindowType.POPUP)
        win.set_name("dsh-toast")
        win.set_wmclass("dsh-attention-toast", "DshAttentionToast")
        win.set_decorated(False)
        win.set_resizable(False)
        win.set_keep_above(True)
        win.set_skip_taskbar_hint(True)
        win.set_skip_pager_hint(True)
        win.set_accept_focus(False)
        win.set_focus_on_map(False)
        win.set_type_hint(Gdk.WindowTypeHint.NOTIFICATION)
        win.set_opacity(0.0)
        self.win = win

        outer = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=0)
        outer.get_style_context().add_class("card")

        bar = Gtk.Box()
        bar.set_size_request(5, -1)
        bar.get_style_context().add_class("accent")
        pb = Gtk.CssProvider()
        pb.load_from_data(("#dsh-toast .accent { background: %s; }" % accent).encode())
        bar.get_style_context().add_provider(pb, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

        content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=3)
        content.set_border_width(11)
        win.set_size_request(int(host.config["width"]), -1)

        head = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        kick = Gtk.Label(label=(self.kicker or KIND_LABEL[host.config["locale"]][self.kind]).upper(), xalign=0)
        kick.get_style_context().add_class("kicker")
        kp = Gtk.CssProvider(); kp.load_from_data(("#dsh-toast .kicker { color: %s; }" % accent).encode())
        kick.get_style_context().add_provider(kp, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        head.pack_start(kick, True, True, 0)
        close = Gtk.Button(label="✕")
        close.get_style_context().add_class("close")
        close.set_relief(Gtk.ReliefStyle.NONE)
        close.set_tooltip_text("关闭" if host.config["locale"] == "zh" else "Dismiss")
        close.connect("clicked", lambda *_: self.close("dismiss"))
        head.pack_end(close, False, False, 0)
        content.pack_start(head, False, False, 0)

        title = Gtk.Label(label=self.title or self.text[:40], xalign=0)
        title.get_style_context().add_class("title")
        title.set_ellipsize(Pango.EllipsizeMode.END)
        title.set_max_width_chars(34)
        tp = Gtk.CssProvider(); tp.load_from_data(("#dsh-toast .title { color: %s; }" % fg).encode())
        title.get_style_context().add_provider(tp, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        content.pack_start(title, False, False, 0)

        if self.text:
            body = Gtk.Label(label=self.text, xalign=0)
            body.get_style_context().add_class("body")
            body.set_line_wrap(True)
            body.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR)
            body.set_max_width_chars(34)
            body.set_lines(3)
            body.set_ellipsize(Pango.EllipsizeMode.END)
            bp = Gtk.CssProvider(); bp.load_from_data(("#dsh-toast .body { color: %s; }" % fg).encode())
            body.get_style_context().add_provider(bp, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
            content.pack_start(body, False, False, 0)

        outer.pack_start(bar, False, False, 0)
        outer.pack_start(content, True, True, 0)
        win.add(outer)

        win.connect("button-press-event", lambda *_: self.clicked())
        win.connect("enter-notify-event", lambda *_: self.set_hover(True))
        win.connect("leave-notify-event", lambda *_: self.set_hover(False))
        win.connect("size-allocate", self.on_alloc)
        win.connect("destroy", lambda *_: None)

        provider = Gtk.CssProvider()
        provider.load_from_data(("#dsh-toast .card { background: %s; }" % bg).encode())
        outer.get_style_context().add_provider(provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

        self.win.show_all()
        self.win.set_opacity(0.0)
        GLib.timeout_add(16, self.fade_in)
        self.schedule()

    def on_alloc(self, _w, alloc):
        self.height = alloc.height
        self.host.layout()

    def fade_in(self):
        self.win.set_opacity(min(1.0, self.win.get_opacity() + 0.16))
        return self.win.get_opacity() < 1.0

    def set_hover(self, on):
        self.hovered = on
        if on:
            if self.timer:
                GLib.source_remove(self.timer); self.timer = None
        else:
            self.schedule()

    def schedule(self):
        if self.timer:
            GLib.source_remove(self.timer)
        self.timer = GLib.timeout_add(max(1500, self.duration), lambda: (self.close("timeout"), False)[1])

    def clicked(self):
        try:
            self.host.raise_owner()
        except Exception:
            pass
        emit({"event": "clicked", "id": self.id})
        self.close("click")

    def close(self, reason="timeout"):
        if self.closing:
            return
        self.closing = True
        if self.timer:
            GLib.source_remove(self.timer); self.timer = None
        emit({"event": "closed", "id": self.id, "reason": reason})
        self.host.remove(self)
        self.win.destroy()


class Host:
    def __init__(self):
        self.config = json.loads(json.dumps(DEFAULT_CONFIG))
        self.toasts = []
        # pid of the DSH process whose window a click should raise (issue #1),
        # plus the executable that owns the window (the Electron main process).
        self.owner_pid = 0
        self.owner_exe = ""
        self.screen = Gdk.Screen.get_default()
        self.monitor = Gdk.Display.get_default().get_primary_monitor()
        self.provider = Gtk.CssProvider()
        self.provider.load_from_data(CSS)
        Gtk.StyleContext.add_provider_for_screen(self.screen, self.provider,
                                                 Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

    def workarea(self):
        geo = self.monitor.get_geometry()
        try:
            wa = self.monitor.get_workarea()
            return wa.x, wa.y, wa.width, wa.height
        except Exception:
            return geo.x, geo.y, geo.width, geo.height

    def show(self, payload):
        t = Toast(self, payload)
        self.toasts.append(t)
        while len(self.toasts) > max(1, int(self.config["maxVisible"])):
            self.toasts[0].close("overflow")
        self.layout()
        emit({"event": "shown", "id": t.id, "kind": t.kind})
        return t

    def remove(self, t):
        if t in self.toasts:
            self.toasts.remove(t)
        self.layout()

    def layout(self):
        x0, y0, w, h = self.workarea()
        width = int(self.config["width"])
        y = y0 + h - MARGIN
        for t in reversed(self.toasts):
            th = t.height or 72
            y -= th
            t.win.move(x0 + w - width - MARGIN, y)
            y -= GAP

    @staticmethod
    def _pid_chain(start):
        """This process and its ancestors, nearest first."""
        chain = []
        pid = int(start or 0)
        for _ in range(8):
            if pid <= 0 or pid in chain:
                break
            chain.append(pid)
            try:
                with open("/proc/%d/stat" % pid, "r") as fh:
                    fields = fh.read().rsplit(")", 1)[-1].split()
                pid = int(fields[1])
            except Exception:
                break
        return chain

    def _owner_pids(self):
        """Pids whose windows belong to DSH.

        The window is owned by the Electron main process, which is an ancestor
        of this host, not the pid the plugin reports (that is the plugin-host
        child), so both chains are searched.
        """
        # Unlike Windows there is no shell process in this chain that owns
        # windows (the desktop session's ancestors are mutter/gnome-shell, which
        # are not X11 clients), so every ancestor is kept. Filtering by the
        # plugin host's executable would be wrong here: the plugin host may run
        # under node while the window belongs to deepseek-harness.
        pids = []
        for pid in self._pid_chain(os.getpid()) + self._pid_chain(self.owner_pid):
            if pid and pid not in pids:
                pids.append(pid)
        return pids

    def raise_owner(self):
        """Best-effort "bring DSH to the front" before the click is reported.

        A renderer's window.focus() cannot un-minimize a window, so the native
        host asks the window manager. xdotool/wmctrl are optional: if neither is
        installed, or the window is not an X11 one, the click still navigates and
        the window just stays where it was.
        """
        pids = self._owner_pids()
        self._raise_log = ["pids=" + ",".join(str(p) for p in pids)]
        if not pids:
            return False
        for pid in pids:
            # No --onlyvisible: a minimized window has _NET_WM_STATE_HIDDEN and is
            # not viewable, so filtering on visibility would skip exactly the window
            # the user wants back.
            try:
                out = subprocess.run(["xdotool", "search", "--pid", str(pid)],
                                     capture_output=True, text=True, timeout=1.5)
                ids = [line.strip() for line in (out.stdout or "").splitlines() if line.strip()]
            except Exception:
                ids = []
            self._raise_log.append("pid %d ids=%s" % (pid, " ".join(ids)))
            for wid in reversed(ids):
                try:
                    geo = subprocess.run(["xdotool", "getwindowgeometry", "--shell", wid],
                                         capture_output=True, text=True, timeout=1.5).stdout or ""
                except Exception:
                    geo = ""
                width = 0
                for line in geo.splitlines():
                    if line.startswith("WIDTH="):
                        try:
                            width = int(line.split("=", 1)[1])
                        except Exception:
                            width = 0
                if width < 200:
                    self._raise_log.append("wid %s width=%d skipped" % (wid, width))
                    continue
                self._raise_log.append("activate wid %s width=%d" % (wid, width))
                for args in (["xdotool", "windowactivate", "--sync", wid],
                             ["xdotool", "windowraise", wid]):
                    try:
                        done = subprocess.run(args, timeout=2.0)
                        self._raise_log.append("  %s -> %s" % (args[1], done.returncode))
                    except Exception as exc:
                        self._raise_log.append("  %s -> error %s" % (args[1], exc))
                        continue
                return True
        try:
            out = subprocess.run(["wmctrl", "-lp"], capture_output=True, text=True, timeout=1.5)
            for line in (out.stdout or "").splitlines():
                parts = line.split(None, 4)
                if len(parts) >= 3 and parts[2] in [str(p) for p in pids]:
                    try:
                        subprocess.run(["wmctrl", "-i", "-a", parts[0]], timeout=1.5)
                        return True
                    except Exception:
                        return False
        except Exception:
            pass
        return False

    def set_config(self, patch):
        for k, v in (patch or {}).items():
            if k == "colors" and isinstance(v, dict):
                for kind, col in v.items():
                    if kind in self.config["colors"] and isinstance(col, dict):
                        self.config["colors"][kind].update({kk: str(vv) for kk, vv in col.items()})
            else:
                self.config[k] = v
        self.layout()

    def handle(self, line):
        try:
            msg = json.loads(line)
        except Exception:
            emit({"event": "error", "message": "bad json"})
            return True
        cmd = msg.get("cmd")
        if cmd == "show":
            self.show(msg)
        elif cmd == "close":
            for t in list(self.toasts):
                if t.id == str(msg.get("id")):
                    t.close("request")
        elif cmd == "debug-click":
            for t in list(self.toasts):
                if t.id == str(msg.get("id")):
                    t.clicked()
                    break
        elif cmd == "close-all":
            for t in list(self.toasts):
                t.close("request")
        elif cmd == "config":
            self.set_config(msg.get("config") or {})
            emit({"event": "config", "ok": True})
        elif cmd == "debug-raise":
            ok = False
            try:
                ok = self.raise_owner()
            except Exception as exc:
                self._raise_log = getattr(self, "_raise_log", []) + ["exception %s" % exc]
            emit({"event": "raise", "ok": bool(ok), "log": getattr(self, "_raise_log", [])})
        elif cmd == "debug-ancestors":
            emit({"event": "ancestors", "pids": self._owner_pids()})
        elif cmd == "owner":
            try:
                self.owner_pid = int(msg.get("pid") or 0)
            except Exception:
                self.owner_pid = 0
            self.owner_exe = str(msg.get("exe") or "")
            emit({"event": "owner", "ok": True})
        elif cmd == "shot":
            path = msg.get("path") or "/tmp/toast.png"
            ok = False
            if self.toasts:
                t = self.toasts[-1]
                gw = t.win.get_window()
                g = gw.get_geometry()
                pb = Gdk.pixbuf_get_from_window(gw, 0, 0, g.width, g.height)
                if pb is not None and pb.get_width() > 0:
                    pb.savev(path, "png", [], [])
                    ok = True
                    emit({"event": "shot", "path": path, "w": g.width, "h": g.height})
            emit({"event": "shot-done", "ok": ok})
        elif cmd == "debug":
            for w in Gtk.Window.list_toplevels():
                gw = w.get_window()
                emit({"event": "debug", "title": w.get_title(), "xid": gw.get_xid() if gw else None,
                      "mapped": w.get_mapped(), "visible": w.get_visible(),
                      "geom": (lambda g: [g.width, g.height, g.x, g.y])(gw.get_geometry()) if gw else None})
        elif cmd == "ping":
            emit({"event": "pong", "at": int(time.time() * 1000)})
        elif cmd == "preview":
            demo = [
                {"kind": "completed", "title": "重构上传接口", "text": "主线任务完成，已生成 3 个文件"},
                {"kind": "permission", "title": "需要你确认", "text": "bash: rm -rf build/  —  允许执行？"},
                {"kind": "sidelinedone", "title": "支线任务全部结束", "text": "4 个后台会话已完成"},
            ]
            for i, d in enumerate(demo):
                d["id"] = "preview-%d" % i
                d["durationMs"] = 6000
                self.show(d)
        elif cmd == "shutdown":
            Gtk.main_quit()
            return False
        return True

    def run(self):
        GLib.unix_fd_add_full(GLib.PRIORITY_DEFAULT, 0, GLib.IOCondition.IN | GLib.IOCondition.HUP,
                              self.on_stdin, None)
        emit({"event": "ready", "pid": os.getpid(), "width": self.workarea()[2]})
        Gtk.main()

    def on_stdin(self, fd, cond, _data):
        line = sys.stdin.readline()
        if not line:
            Gtk.main_quit()
            return False
        line = line.strip()
        if line:
            self.handle(line)
        return True


if __name__ == "__main__":
    Host().run()
