# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## NixOS config location

The live config is a flake-based git repo at `/etc/nixos/` — not in this home directory. All edits, rebuilds, and git operations target that path. Flakes only see git-tracked files; always `git add <file>` before rebuilding.

## Rebuild commands

```bash
# Apply and activate
sudo nixos-rebuild switch --flake /etc/nixos#homeserver

# Test without making it the boot default
sudo nixos-rebuild test --flake /etc/nixos#homeserver

# Set next boot only (no runtime change)
sudo nixos-rebuild boot --flake /etc/nixos#homeserver

# Roll back to the previous generation
sudo nixos-rebuild switch --rollback
```

Tag stable states: `git tag working-YYYY-MM-DD` (latest: `working-2026-09-13`). To restore: `git checkout <tag>` then rebuild.

## Repository layout (`/etc/nixos/`)

```
flake.nix                    — single nixosConfigurations.homeserver; inputs: nixpkgs 25.11,
                               nixpkgs-unstable (Nextcloud34), nix-minecraft
hosts/homeserver/            — hardware config (partition UUIDs, swap, CIFS mounts, hostname)
modules/                     — NixOS modules; all loaded by every build:
  common.nix, desktop-kde.nix, lan-apps.nix, minecraft.nix, databases.nix,
  nginx.nix, samba.nix, emby.nix, nextcloud.nix, pihole-container.nix, xrdp.nix
apps/                        — source for custom LAN apps (canonical copy; ExecStart refs nix store path)
pkgs/                        — custom packages (brave-origin-nightly)
```

## Services and ports

| Service | Port | Notes |
|---|---|---|
| homepage (nginx) | 5000 | Static site from `apps/homepage/`; `/reference.html` is this doc |
| typing-tutor | 3000 | Node/Express |
| math-tutor | 3001 | Node/Express |
| lan-pastebin | 5001 | Flask/waitress |
| music-info-library | 5010 | Flask/waitress; secrets at `/var/lib/music-info/secrets.env` |
| Emby | 8096 / 8920 | Podman container (pinned digest); PUID=0 PGID=125 |
| Nextcloud | 443 | `cloud.intrentaka.com`; native NixOS module, unstablePkgs.nextcloud34; MySQL |
| Pi-hole | 8083 | Podman container; internal port 8080→8083 pinned via `FTLCONF_webserver_port` |
| mc-control | 5020 | Flask/waitress; sudo-limited start/stop/is-active for Minecraft |
| Minecraft | 25565 | paper-1_19_4; `autoStart=false`; `online-mode=false` (LAN only) |

External domains: `intrentaka.com` / `www.intrentaka.com` → Emby; `cloud.intrentaka.com` → Nextcloud. Let's Encrypt via NixOS ACME (ports 80+443 forwarded from router).

**Router:** TP-Link ER605. Port forwarding lives at **Transmission → NAT → Virtual Servers** (standalone UI) or **Settings → Transmission → NAT → Virtual Servers** (Omada controller). Required rules: WAN:80 → 192.168.0.120:80 TCP, WAN:443 → 192.168.0.120:443 TCP. If external domains become unreachable, check these rules first — the ER605 loses them on some firmware updates/resets.

**LAN DNS (split-horizon):** Pi-hole serves local DNS on port 53. `/var/lib/pihole/etc-pihole/custom.list` maps the external domains to 192.168.0.120 so LAN clients bypass the router (ER605 does not support hairpin NAT). After editing that file: `sudo systemctl restart podman-pihole.service`. The file is not tracked in the NixOS config — it lives in the Pi-hole volume and survives rebuilds, but would need to be recreated if `/var/lib/pihole/` is wiped.

```bash
systemctl --failed                 # anything that didn't start
journalctl -u <service> -f         # live logs
```

## Secrets (never in repo)

| File | Owner | Mode | Contents |
|---|---|---|---|
| `/home/kryt/.smbcredentials` | `kryt:kryt` | 600 | `username`, `password`, `domain` for CIFS |
| `/var/lib/music-info/secrets.env` | `music-info:music-info` | 600 | `DISCOGS_TOKEN`, `EMBY_API_KEY`, `EMBY_BASE_URL`, `EMBY_EXTERNAL_URL` (`MUSIC_PATH` is set in the systemd unit in `modules/lan-apps.nix`) |
| `/var/lib/pihole/secrets.env` | `root:root` | 600 | `WEBPASSWORD` |
| `/var/lib/nextcloud-admin-pass` | `root:root` | 600 | Single-line admin password |
| `/var/lib/nextcloud/nc-secrets.php` | `nextcloud:nextcloud` | 400 | JSON (despite `.php` extension — nextcloud34 module requirement); must preserve original `instanceid`, `passwordsalt`, `secret` values from backup or all user passwords are invalidated |

Verify secrets with: `bash /home/kryt/check-secrets.sh`

## Critical conventions

**UID/GID pins** — `users.users.nextcloud.uid = 991` is declared in `modules/nextcloud.nix` as `homeserver.nextcloudUid`; the CIFS mount in `hosts/homeserver/configuration.nix` uses the same value via `uid=991`. Change the option in `nextcloud.nix` and both update together — never diverge them.

`users.groups.sambashare.gid = 125` — used by CIFS mounts; Emby (PGID=125), music-info, nextcloud, and kryt are all members of this group.

**mc-control sudo path** — `mc-control` calls `/run/wrappers/bin/sudo` (the setuid wrapper NixOS creates at boot), not `/run/current-system/sw/bin/sudo` (which lacks the setuid bit). The sudo rules in `modules/minecraft.nix` reference the `sw` path for the allowed commands. If mc-control returns `{"status":"unknown"}` after a reinstall, verify `/run/wrappers/bin/sudo` is setuid root.

**Minecraft unit name** — defined once as `mcServerName = "survival"` in `modules/minecraft.nix`; the systemd unit is `minecraft-server-survival.service`.

**Pi-hole port** — internal port is pinned to 8080 via `FTLCONF_webserver_port` in the container env so Teleporter restores don't flip it back to 80.

## Music scanner

Reads `Artist/Album/NN - Title.mp3` directory structure; 16 parallel CIFS workers; ~27,000 tracks in ~13 minutes. Full wipe + rebuild of the `tracks` table on every run.

```bash
sudo systemctl start music-scanner
journalctl -fu music-scanner
```
