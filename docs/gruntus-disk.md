# The RTX 4090 machine's disk

Written 3 Oct 2026, so that a disk limit is recognised for what it is if one turns up. Read off the machine on 2 Oct
2026 (`lsblk`, `findmnt`, `/sys/block`, `/proc/swaps`) unless it says it was measured.

## What is there

| | |
|---|---|
| Drive | one Samsung SSD 980 PRO 2 TB, NVMe, firmware 5B2QGXA7 |
| Link | PCIe 4.0 x4 (16 GT/s, the drive's maximum, at its full width) |
| Layout | EFI (260 MB), a Windows recovery area, three NTFS partitions (500 MB, 475 GB, 736 MB), and one ext4 partition of 1.4 TB mounted as `/` |
| Mount | `/` is ext4, `rw,relatime,errors=remount-ro`; `/home` is on it, not on a separate volume |
| I/O scheduler | `none`, 1,023 queue slots |
| Swap | one 2 GiB file, `/swapfile`, with 1.9 GiB of it in use when read; `vm.swappiness` 60 |
| Boot | dual boot with Windows. The machine is switched to Windows from time to time, and the 475 GB NTFS partition is Windows's |
| Used | about 600 GB of 1.4 TB (47%), 697 GB free |

There is no second drive. Everything shares the one: the operating system, every model, every run's workspace and
logs, the browser caches, and the repository clones.

## What was measured

- **Sequential read, bypassing the page cache** (`dd` with `iflag=direct`, 8 GiB from a model file, 2 Oct 2026, nothing
  else running): **6.2 GB/s**. That is close to the drive's rated 7 GB/s.

## What was not measured

- **Random reads and latency.** `fio`, `nvme-cli` and `smartctl` are not installed, and a read test would disturb the
  benchmark running on the machine. Strata's n-gram table is read in 90-byte rows, one random read per token position
  with up to 64 in flight, and not through the page cache (`--ple-io direct`, its default). Whether that is limited by
  the drive is the figure to take, between runs, before blaming the disk for slow Strata runs.
- **Drive health and wear.** Not read.

## Where the disk could limit us

1. **Strata's n-gram table.** The 28.8 GB second GGUF file is a lookup table read off the SSD for every token. It is
   the one place a model on this machine reads the disk while it generates. Every other model here is loaded into RAM
   and VRAM at start and then runs without it.
2. **A model load.** 75.8 GB for Strata's files, and the other models' files, are read in full at start. At 6.2 GB/s a
   load is limited by the disk for a few seconds, not by anything else.
3. **Swap.** The swap file is on the same drive and was nearly full at 1.9 of 2 GiB. If a run pushes RAM into swap,
   the drive serves swap and the n-gram reads together. Strata's measured resident set is 43 GiB of RAM on a machine
   with 62 GiB, so it leaves about 19 GiB for the agent, browsers and test servers.
4. **Free space.** 697 GB free. A Strata install adds about 85 GB (`~/.local/share/awesome-local-ai/strata/`), and a
   run writes its workspace and logs.

## If it becomes a bottleneck

In order of cost: measure random read on `/` between runs and compare it with Strata's own table-read figures; move
the swap file or add RAM; put the n-gram file on a second NVMe drive on the board's other M.2 slot, if it has one (not
checked). A change to the machine's disk layout is the owner's, not an agent's.
