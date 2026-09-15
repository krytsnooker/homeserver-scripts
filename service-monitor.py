#!/usr/bin/env python3
import sys
import subprocess
import urllib.request
import urllib.error
import ssl
import socket
from datetime import datetime

from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QPushButton, QTableWidget, QTableWidgetItem, QHeaderView,
    QGroupBox, QSizePolicy,
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal
from PyQt6.QtGui import QColor, QFont, QIcon


SERVICES = [
    # (display name, systemd unit or None, port or None, scheme: "http"/"tcp"/None, ext_hostname or None)
    ("nginx",               "nginx.service",                       None,  None,   None),
    ("homepage",            None,                                  5000,  "http", None),
    ("typing-tutor",        "typing-tutor.service",                3000,  "http", None),
    ("math-tutor",          "math-tutor.service",                  3001,  "http", None),
    ("lan-pastebin",        "lan-pastebin.service",                5001,  "http", None),
    ("music-info",          "music-info.service",                  5010,  "http", None),
    ("Emby",                "podman-emby.service",                 8096,  "http", "intrentaka.com"),
    ("Pi-hole",             "podman-pihole.service",               8083,  "http", None),
    ("Nextcloud PHP-FPM",   "phpfpm-nextcloud.service",            None,  None,   None),
    ("Nextcloud HTTPS",     None,                                  443,   "tcp",  "cloud.intrentaka.com"),
    ("redis-nextcloud",     "redis-nextcloud.service",             None,  None,   None),
    ("mc-control",          "mc-control.service",                  5020,  "http", None),
    ("Minecraft",           "minecraft-server-survival.service",   25565, "tcp",  None),
]

HOSTNAME_CHECK = "homeserver.lan"
EXPECTED_IP    = "192.168.0.120"
CIFS_MOUNTS    = ["/mnt/server-pc", "/var/lib/nextcloud/data"]

COL_GREEN  = QColor("#27ae60")
COL_RED    = QColor("#e74c3c")
COL_GRAY   = QColor("#95a5a6")
ROW_RED_BG = QColor("#fdecea")


# ---------------------------------------------------------------------------
# Check helpers (all run in the worker thread)
# ---------------------------------------------------------------------------

def _systemd(unit):
    try:
        r = subprocess.run(
            ["systemctl", "is-active", unit],
            capture_output=True, text=True, timeout=5,
        )
        s = r.stdout.strip()
        return s, s == "active"
    except Exception:
        return "error", False


def _http(port):
    try:
        url = f"http://127.0.0.1:{port}/"
        with urllib.request.urlopen(url, timeout=5) as resp:
            return str(resp.status), True
    except urllib.error.HTTPError as e:
        return str(e.code), True   # got a response = service is up
    except Exception:
        return "no response", False


def _tcp(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=5):
            return "open", True
    except Exception:
        return "unreachable", False


def _https_vhost(hostname):
    """Connect to 127.0.0.1:443 with SNI for hostname. Tests nginx vhost routing, SSL cert, and upstream."""
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection(("127.0.0.1", 443), timeout=5) as raw:
            with ctx.wrap_socket(raw, server_hostname=hostname) as s:
                s.sendall(f"GET / HTTP/1.1\r\nHost: {hostname}\r\nConnection: close\r\n\r\n".encode())
                data = s.recv(512).decode("utf-8", errors="replace")
        line = data.split("\r\n")[0]
        parts = line.split()
        code = parts[1] if len(parts) >= 2 else "?"
        return code, True
    except ssl.SSLCertVerificationError:
        return "cert error", False
    except ssl.SSLError:
        return "ssl error", False
    except Exception:
        return "no response", False


def _hostname(name):
    try:
        ip = socket.getaddrinfo(name, None)[0][4][0]
        return ip, ip == EXPECTED_IP
    except Exception:
        return "unresolved", False


def _failed_units():
    try:
        r = subprocess.run(
            ["systemctl", "--failed", "--no-legend"],
            capture_output=True, text=True, timeout=5,
        )
        lines = [l for l in r.stdout.strip().splitlines() if l.strip()]
        return len(lines)
    except Exception:
        return -1


def _cifs(path):
    try:
        with open("/proc/mounts") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 3 and parts[1] == path and "cifs" in parts[2]:
                    return True
        return False
    except Exception:
        return False


def run_checks():
    results = {
        "timestamp":    datetime.now().strftime("%Y-%m-%d  %H:%M:%S"),
        "failed_units": _failed_units(),
        "hostname":     _hostname(HOSTNAME_CHECK),
        "mounts":       {p: _cifs(p) for p in CIFS_MOUNTS},
        "services":     [],
    }

    for name, unit, port, scheme, ext_host in SERVICES:
        svc = {"name": name}

        if unit:
            svc["sys_text"], svc["sys_ok"] = _systemd(unit)
        else:
            svc["sys_text"] = svc["sys_ok"] = None

        if port and scheme == "tcp":
            svc["port_text"], svc["port_ok"] = _tcp(port)
        elif port:
            svc["port_text"], svc["port_ok"] = _http(port)
        else:
            svc["port_text"] = svc["port_ok"] = None

        if ext_host:
            svc["ext_text"], svc["ext_ok"] = _https_vhost(ext_host)
        else:
            svc["ext_text"] = svc["ext_ok"] = None

        checks = [v for v in [svc["sys_ok"], svc["port_ok"], svc["ext_ok"]] if v is not None]
        svc["ok"] = all(checks) if checks else None

        results["services"].append(svc)

    return results


# ---------------------------------------------------------------------------
# Background worker
# ---------------------------------------------------------------------------

class Worker(QThread):
    finished = pyqtSignal(dict)

    def run(self):
        self.finished.emit(run_checks())


# ---------------------------------------------------------------------------
# Main window
# ---------------------------------------------------------------------------

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Homeserver — Service Status")
        self.resize(920, 640)
        self._worker = None
        self._build_ui()
        self.refresh()

    # ---- UI construction --------------------------------------------------

    def _build_ui(self):
        root = QWidget()
        self.setCentralWidget(root)
        vbox = QVBoxLayout(root)
        vbox.setSpacing(0)
        vbox.setContentsMargins(0, 0, 0, 0)

        vbox.addWidget(self._make_header())
        vbox.addWidget(self._make_body())

    def _make_header(self):
        w = QWidget()
        w.setStyleSheet("background-color: #1e2a38;")
        w.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)

        h = QHBoxLayout(w)
        h.setContentsMargins(24, 16, 24, 16)

        title = QLabel("HOMESERVER")
        f = QFont()
        f.setPointSize(15)
        f.setBold(True)
        f.setLetterSpacing(QFont.SpacingType.AbsoluteSpacing, 1.5)
        title.setFont(f)
        title.setStyleSheet("color: #ecf0f1;")

        self.ts_label = QLabel("")
        self.ts_label.setStyleSheet("color: #7f8c8d; font-size: 12px;")

        self.btn = QPushButton("Refresh")
        self.btn.setFixedWidth(90)
        self.btn.setStyleSheet("""
            QPushButton {
                background: #2980b9; color: white;
                border: none; padding: 6px 0; border-radius: 4px;
                font-size: 13px;
            }
            QPushButton:hover    { background: #3498db; }
            QPushButton:disabled { background: #2c3e50; color: #7f8c8d; }
        """)
        self.btn.clicked.connect(self.refresh)

        h.addWidget(title)
        h.addStretch()
        h.addWidget(self.ts_label)
        h.addSpacing(20)
        h.addWidget(self.btn)
        return w

    def _make_body(self):
        w = QWidget()
        w.setStyleSheet("background: #f0f2f5;")
        v = QVBoxLayout(w)
        v.setContentsMargins(20, 20, 20, 20)
        v.setSpacing(14)

        # System health group
        self.sys_group = QGroupBox("System Health")
        self._style_group(self.sys_group)
        self.sys_inner = QVBoxLayout(self.sys_group)
        self.sys_inner.setSpacing(4)
        v.addWidget(self.sys_group)

        # Services table group
        svc_group = QGroupBox("Services")
        self._style_group(svc_group)
        svc_inner = QVBoxLayout(svc_group)

        self.table = QTableWidget()
        self.table.setColumnCount(5)
        self.table.setHorizontalHeaderLabels(["Service", "Systemd", "Port", "External", "Detail"])
        hdr = self.table.horizontalHeader()
        hdr.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        hdr.setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        hdr.setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        hdr.setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        hdr.setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.setSelectionMode(QTableWidget.SelectionMode.NoSelection)
        self.table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.table.setAlternatingRowColors(False)
        self.table.setStyleSheet("""
            QTableWidget {
                border: none;
                font-size: 13px;
                gridline-color: #dfe6e9;
                outline: none;
            }
            QHeaderView::section {
                background: #dfe6e9;
                padding: 6px 10px;
                border: none;
                font-weight: bold;
                color: #2c3e50;
            }
            QTableWidget::item { padding: 4px 10px; color: #2c3e50; }
        """)

        svc_inner.addWidget(self.table)
        v.addWidget(svc_group)
        return w

    @staticmethod
    def _style_group(g):
        g.setStyleSheet("""
            QGroupBox {
                background: white;
                border: 1px solid #dfe6e9;
                border-radius: 5px;
                margin-top: 10px;
                font-weight: bold;
                font-size: 13px;
                color: #2c3e50;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 12px;
                padding: 0 4px;
            }
        """)

    # ---- Refresh ----------------------------------------------------------

    def refresh(self):
        if self._worker and self._worker.isRunning():
            return
        self.btn.setEnabled(False)
        self.btn.setText("Checking…")
        self._worker = Worker()
        self._worker.finished.connect(self._on_done)
        self._worker.start()

    def _on_done(self, r):
        self._update_system(r)
        self._update_table(r["services"])
        self.ts_label.setText(f"Last checked: {r['timestamp']}")
        self.btn.setEnabled(True)
        self.btn.setText("Refresh")

    # ---- System health panel ----------------------------------------------

    def _update_system(self, r):
        # Clear existing rows
        while self.sys_inner.count():
            item = self.sys_inner.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        failed = r["failed_units"]
        self._sys_row(
            failed == 0,
            "No failed systemd units" if failed == 0
            else f"{failed} failed unit(s) — run: systemctl --failed",
        )

        ip, ok = r["hostname"]
        self._sys_row(ok, f"{HOSTNAME_CHECK}  →  {ip}")

        for path, ok in r["mounts"].items():
            self._sys_row(ok, f"CIFS  {path}  {'✓ mounted' if ok else '✗ not mounted'}")

    def _sys_row(self, ok, text):
        lbl = QLabel()
        color = "#27ae60" if ok else "#e74c3c"
        lbl.setText(f'<span style="color:{color}; font-size:15px;">●</span>&nbsp;&nbsp;{text}')
        lbl.setTextFormat(Qt.TextFormat.RichText)
        lbl.setStyleSheet("font-size: 13px; padding: 2px 6px; color: #2c3e50;")
        self.sys_inner.addWidget(lbl)

    # ---- Services table ---------------------------------------------------

    def _update_table(self, services):
        self.table.setRowCount(len(services))
        for row, svc in enumerate(services):
            failed = svc["ok"] is False
            if failed:
                bg = ROW_RED_BG
            elif row % 2 == 0:
                bg = QColor("#ffffff")
            else:
                bg = QColor("#f4f6f8")

            self._cell(row, 0, svc["name"], bg=bg, bold=True)
            self._status_cell(row, 1, svc["sys_ok"],  svc["sys_text"],  bg)
            self._status_cell(row, 2, svc["port_ok"], svc["port_text"], bg)
            self._status_cell(row, 3, svc["ext_ok"],  svc["ext_text"],  bg)
            self._cell(row, 4, svc["port_text"] if svc["port_ok"] is not None else "", bg=bg,
                       color=QColor("#7f8c8d"))

        self.table.resizeRowsToContents()

    def _cell(self, row, col, text, bg=None, color=None, bold=False, align=None):
        item = QTableWidgetItem(text or "")
        if bg is not None:
            item.setBackground(bg)
        if color is not None:
            item.setForeground(color)
        if bold:
            f = item.font()
            f.setBold(True)
            item.setFont(f)
        if align:
            item.setTextAlignment(align)
        self.table.setItem(row, col, item)

    def _status_cell(self, row, col, ok, text, bg):
        if ok is None:
            item = QTableWidgetItem("—")
            item.setForeground(COL_GRAY)
            item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            if bg is not None:
                item.setBackground(bg)
            self.table.setItem(row, col, item)
            return

        label = "active" if (ok and text and "active" in text) else ("ok" if ok else (text or "fail"))
        item = QTableWidgetItem(f"● {label}")
        item.setForeground(COL_GREEN if ok else COL_RED)
        item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        if bg is not None:
            item.setBackground(bg)
        self.table.setItem(row, col, item)


# ---------------------------------------------------------------------------

def main():
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    win = MainWindow()
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
