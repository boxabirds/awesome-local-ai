# Sum the Vulkan per-operation timings of one llama-bench prefill and show each operation's share.
# Usage: uv run summarise_ops.py <ubN-ppN-ops.log from llama-prefill-profile.sh>
# llama-bench runs a warm-up pass too, so the total is about twice one run's time; the shares are unaffected.
import re, sys, collections

TOP_OPS = 12
US_PER_S = 1e6
tot = collections.Counter()
for line in open(sys.argv[1], errors="replace"):
    m = re.match(r"^(\S.*?): (\d+) x [\d.]+ us = ([\d.]+) us", line)
    if m:
        name = re.sub(r"\(.*$", "", m.group(1)).strip()
        op = name.split()[0]
        tot[op] += float(m.group(3))
all_us = sum(tot.values())
print(f"total GPU op time: {all_us/US_PER_S:.2f} s")
for op, us in tot.most_common(TOP_OPS):
    print(f"  {op:28s} {us/US_PER_S:8.2f} s  {100*us/all_us:5.1f}%")
