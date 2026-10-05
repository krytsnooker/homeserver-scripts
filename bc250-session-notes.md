# BC-250 Session Notes — 2026-09-29

## Config Restructure

### What was done
- Removed `hosts/bc250/` nesting (single-machine config doesn't need it)
- Moved `disko/bc250.nix` → `disko.nix` (root)
- Moved `hosts/bc250/hardware-configuration.nix` → `hardware-configuration.nix` (root)
- Split monolithic `gaming.nix` into focused modules
- Renamed `bios/citron/` → `bios/eden/` throughout (legacy name from when emulator was called Citron)
- Extracted Eden into its own module

### Final structure
```
flake.nix
disko.nix
hardware-configuration.nix       — stub { }; generate with nixos-generate-config on fresh install
configuration.nix                 — hostname, user, boot, network, podman, CIFS, stateVersion
post-install.md                   — post-install checklist
patches/
  bc250-40cu-unlock.patch         — kernel patch for 40 CU unlock
modules/
  hardware.nix                    — GPU, Bluetooth, ACPI fix, governor, OC, KWin DRM fix, CU unlock
  desktop.nix                     — KDE Plasma 6, Pipewire, KDE apps, Firefox, claude-code
  system.nix                      — SSH, KRDP, mDNS, Samba client, git config, CLI tools
  gaming.nix                      — Steam + Proton-GE, GameMode, MangoHud
  llm.nix                         — Ollama + ROCm (commented out in flake.nix)
  emulators/
    default.nix                   — RetroArch (11 cores), pcsx2, dolphin-emu, BIOS activation script
    eden.nix                      — programs.eden, cachix (extra-substituters), eden BIOS script
pkgs/
  cyan-skillfish-governor.nix
  bc250-acpi-fix.nix
  bc250-cpu-oc.nix
bios/                             — gitignored; staging for emulator BIOS files
  eden/keys/                      — prod.keys, title.keys
  eden/firmware/                  — Switch NCA files
  retroarch/
  pcsx2/
  dolphin/
```

### Key module notes
- Eden cachix uses `extra-substituters` (not `substituters`) to avoid conflicting with root nix.settings
- KWin DRM fix (`KWIN_DRM_NO_AMS=1`, `card1`) is in `hardware.nix` — BC-250 specific hardware workaround
- `hardware-configuration.nix` is a stub — must be regenerated with `nixos-generate-config` on fresh install

---

## GitHub / Git Setup

- SSH key generated on BC-250 at `~/.ssh/id_ed25519`
- Public key added to GitHub (krytsnooker account)
- Root SSH key copied to `/root/.ssh/` so `sudo git pull` works
- Repo: `git@github.com:krytsnooker/bc250-nixos-config.git`
- Config on BC-250: `/etc/nixos/bc250/`
- Deploy workflow: `sudo git -C /etc/nixos/bc250 pull && sudo nixos-rebuild switch --flake /etc/nixos/bc250#bc250`

---

## Hardware Status

### GPU Governor
- Service: `cyan-skillfish-governor.service` — active, healthy
- DPM states: 1000 / 1500 / 2000 MHz (2150 MHz safe-point in config but not exposed as DPM state)
- At idle: 1000 MHz

### CPU Overclock
- Service: `bc250-cpu-oc.service` — active (exited), status=0/SUCCESS
- SMU communication: Test Message OK
- Applied: 3900 MHz @ scale -27, 90°C limit

### GPU CU Unlock — IN PROGRESS
**Background:**
- BC-250 ships with 24 of 40 CUs active (hardware harvest mask)
- BIOS chip was flashed with a modified BIOS (Robin5.00 = just a filename convention)
- Flash command: `AfuEfix64.efi Robin5.00 /p /b /n /k /x /rlc:e` (full system BIOS flash)
- amdgpu fetches VBIOS from VFCT (ACPI table embedded in system firmware), not from GPU chip
- Current system BIOS: P3.00 (the modified version with hidden chipset menus + VRAM allocation unlock)

**Runtime umr unlock (DONE — active):**
- Service: `bc250-cu-unlock.service` — active, status=0/SUCCESS
- Writes three registers via umr after driver loads:
  - `mmCC_GC_SHADER_ARRAY_CONFIG` → `0x0` (clears harvest mask)
  - `mmSPI_PG_ENABLE_STATIC_WGP_MASK` → `0x1f` (all 5 WGPs per row)
  - `mmRLC_PG_ALWAYS_ON_WGP_MASK` → `0x1f`
- Verified with: `sudo umr -i 1 -r cyan_skillfish.gfx1013.mmSPI_PG_ENABLE_STATIC_WGP_MASK` → `0x1f`
- Limitation: driver still reports 24 CU (enumerated at init before service ran); RADV/ROCm plan for 24

**Kernel patch unlock (DONE):**
- Patch: `duggasco/bc250-40cu-unlock` → `patches/bc250-40cu-unlock.patch`
- Patches `gfx_v10_0_get_cu_info()` in `drivers/gpu/drm/amd/amdgpu/gfx_v10_0.c`
- Activated by kernel param `amdgpu.bc250_cc_write_mode=3`
- Writes CC + SPI + RLC registers at driver init → driver, RADV, ROCm all see 40 CU
- **Verified: `amdgpu_top` shows 40 CU after reboot on 2026-09-29**

---

## Post-Install Checklist Status

| Item | Status |
|---|---|
| Change password | Not done |
| SSH key (GitHub) | Done |
| Samba credentials | Done (mount working) |
| KRDP certificate | Done |
| Claude Code API key | Not done |
| BIOS/emulator files | Not done (bios/ dir empty on BC-250) |

---

## Pending / Next Steps

1. **Kernel rebuild** — currently running on BC-250. When complete: reboot, verify `amdgpu_top` shows 40 CU
2. **CPU core unlock (6→8)** — DONE. Service `bc250-cpu-core-unlock` active. 16 threads confirmed. Volatile — lost on cold boot, re-applied by service on warm reboot.
3. **FSR4** — `daniel-h-0/bc250-fsr4-fork` on GitHub. BC-250 specific fork of FSR4 using OptiScaler Client. Installs per-game into Steam/Heroic/Lutris. Linux support active. Investigate after CU unlock confirmed
4. **llm.nix** — commented out. Enable when doing LLM workloads. Recommended models documented in the module. Remember to set BIOS VRAM split to 10GB GPU / 6GB CPU first
5. **Claude Code API key** — `~/.config/environment.d/secrets.conf` with `ANTHROPIC_API_KEY=<value>`
6. **BIOS files for emulators** — copy from homeserver staging to `/etc/nixos/bios/` on BC-250

---

## Useful Commands

```bash
# GPU state
cat /sys/class/drm/card1/device/pp_dpm_sclk
sudo umr -i 1 -r cyan_skillfish.gfx1013.mmSPI_PG_ENABLE_STATIC_WGP_MASK
amdgpu_top

# CPU state
cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq | sort -u

# Services
systemctl status cyan-skillfish-governor
systemctl status bc250-cpu-oc
systemctl status bc250-cu-unlock

# Deploy
sudo git -C /etc/nixos/bc250 pull
sudo nixos-rebuild switch --flake /etc/nixos/bc250#bc250
sudo nixos-rebuild test --flake /etc/nixos/bc250#bc250   # test without setting boot default

# Git (root-owned repo)
sudo git -C /etc/nixos/bc250 <command>
```
