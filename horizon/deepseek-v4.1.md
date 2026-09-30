# DeepSeek V4.1

**Status:** eliminated (29 Sep 2026): too large for our machines.

A vision-language mixture-of-experts model with 552B backbone parameters plus 196B of Engram memory (hashed
2-, 3- and 4-token lookup tables inside the model), about 750B in total: beyond 128 GB machines. Engram is part
of the model, not a server setting, so it can't be tried on another model.

**Not checked:** whether DeepSeek V4.1-Flash fits any of our machines (Strix Halo 128 GB, M5 Max 128 GB). That is
the recheck.

**Recheck when:** the owner wants a DeepSeek stack; start by reading V4.1-Flash's size and quantised files.

Sources: [Engram paper](https://arxiv.org/pdf/2601.07372) ·
[DeepSeek-V4.1-Flash paper](https://arxiv.org/pdf/2609.19969) ·
[ROCm ATOM: host-side n-gram lookup for DeepSeek-V4.1](https://github.com/ROCm/ATOM/pull/2185)
