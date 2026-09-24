#!/usr/bin/env bash
# combinations/qwen/3.8/flash-next/macos/128GB/mlxserve-opencode/config.sh
#
# Qwen3.8-Flash-Next on a 128 GB Apple silicon Mac, served by mlx-serve (the
# native Zig server, github.com/ddalcu/mlx-serve) from the model author's own
# mixed 4/8-bit pack, driven by OpenCode (or pi).
#
# This file is DATA. All the logic lives in lib/ (lib/mlxserve.sh,
# lib/runtime/server-mlxserve.sh).
#
# NOT MEASURED BY THIS REPO. Nothing here has been run on any machine by this
# repo: every memory figure is an ESTIMATE from file sizes and the model
# config (arithmetic in README.md), and every speed is the model author's,
# quoted with its source. Sources (read 2026-09-24):
#   https://huggingface.co/ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit  (card, config, file list)
#   https://github.com/ddalcu/mlx-serve  @ 7c24003 (source, docs/cli.md, docs/api.md, CHANGELOG.md)

# ---- identity -------------------------------------------------------------
INSTALL_ID="mlxserve-qwen38-flash-next"
DISPLAY_NAME="Qwen3.8-Flash-Next (mlx-serve)"
MODEL_DISPLAY_NAME="Qwen3.8-Flash-Next mlx-serve pack, 4-bit experts / 8-bit rest"
ROOT_ENV_VAR="MLXSERVE_FLASH_NEXT_ROOT"

# Never the automatic pick: the MTPLX combination for the same model on the
# same machine is measured, this one is not. Listed as compatible and
# installable by name.
AUTO_SELECT=0

# ---- platform -------------------------------------------------------------
TARGET_OS="macos"
ACCEL="metal"                             # -> lib/accel/metal.sh
BACKEND="mlxserve"                        # -> lib/mlxserve.sh
CLIENT="${CLIENT:-opencode}"              # default client; pi is installed too (./start.sh <id> --pi)

# mlx-serve ships as a prebuilt binary; the hf CLI comes via lib/hf.sh.
SYSTEM_PACKAGES=()

# Same floor as the MTPLX Flash-Next combination: ~70 GiB of weights plus a
# usable context. Metal's recommendedMaxWorkingSetSize on a 128 GB M5 Max is
# 110,100 MiB (measured for that combination).
MIN_DEVICE_MEM_MIB=92000

# ---- backend --------------------------------------------------------------
# v26.9.5 (2026-09-21) is the floor, not a preference: it is the first release
# with --os-reserve-gib, and its changelog fixes two ways concurrent or
# cache-restored long prompts overran GPU memory ("a kernel panic on macOS
# 26.5"). The pack itself needs >= 26.8.11 (first Flash-Next release; the card
# measured on it). An installed mlx-serve older than this is left alone and a
# pinned copy is unpacked under $HOME instead -- Homebrew's formula in the
# upstream tap was still at 26.9.2 when this was written.
MLXSERVE_VERSION="26.9.5"
# The sha256 GitHub publishes for the release asset mlx-serve-bin-macos-arm64.tar.gz.
MLXSERVE_TARBALL_SHA256="06c087e623a729070fb4b51832bf6acbafc3037ac23368b469f25066413cdbba"
# Free RAM mlx-serve leaves out of every memory plan. Its default on a 128 GB
# Mac is 8 GB (an eighth of RAM, capped at 8). 16 is this repo's choice after
# the 24 Sep 2026 kernel panic, not a measured optimum.
MLXSERVE_OS_RESERVE_GIB=16
# Room the launcher's pre-flight demands on top of need_mib for the prefill
# working set, which nobody has measured for this pack.
MLXSERVE_PREFLIGHT_HEADROOM_MIB=8192

# ---- weights --------------------------------------------------------------
MODEL_REPO="ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit"
MODEL_REVISION="7eaef0fa82b4c3bf5c64cec60ace4bf48fd271e3"
# Inside mlx-serve's own store (~/.mlx-serve/models), where `mlx-serve pull`
# and the MLX-Serve app would put it, so the same copy serves both.
MODEL_WEIGHTS_DIR="ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit"
# From the Hugging Face file list at MODEL_REVISION: 100 shards (69.30 GiB),
# the vision tower (0.84 GiB) and ngram_table.bin (32.00 GB = 29.80 GiB).
MODEL_APPROX_SIZE="107.3 GB (74.4 GB shards + 0.9 GB vision + 32.0 GB n-gram table)"
MODEL_DISK_KB=104811171
# The Hugging Face LFS sha256 of every large file at MODEL_REVISION.
MODEL_SHA256="
b9eac6559ad5d0e36f481a28fb7242129f3448966d9feb25daba67a5ea704aea  model-00001.safetensors
0c1526377d7d46fbf3cb8ff176da2aea699a48115900defffa4dbf7835493d6c  model-00002.safetensors
26856992d952027940280f234b643f2f25eab57cce82b2d40e251e82b38048eb  model-00003.safetensors
2f2f1da063b78e6b2dbb48e8e25a4244868568767224b42179b8769ea9e31703  model-00004.safetensors
6fdcd1826c70487e0be5a4f00e877ec42442c5742fc554e8b3fd1bbabc8d2fb0  model-00005.safetensors
a66bcbcd3aa72c26c72f61d6e2d0e96548743c29cfe23821ca252d06bf1faf2a  model-00006.safetensors
a85aac622cf5d03d290d73550e38ca97fcab2a5a741acb373f591c251dfdf288  model-00007.safetensors
08016d3b0b160f37019ac2e4cdf512cb50801b2786e7ffdce481c66e38d5cbb1  model-00008.safetensors
1102d84db2613ba2f187d313248db5a62bda64c804a3e48b22ceac888a7dfcfd  model-00009.safetensors
fc62f0b2ed35abc75de2668280987b7707009945d158e5a7d97874535ceaf66a  model-00010.safetensors
885a230a785fc3ede87a8ae4a1cdff33c6d4cbb727fc20bbf198bc05f23202ad  model-00011.safetensors
b8926b48b97680f51d64e2a0ab7a2f0895dcf65011c0b09a356bb950370274bb  model-00012.safetensors
6564611feccc3c146b077aa922ebb8dc045e43ddc6e6a9df9bb796a1067be67b  model-00013.safetensors
3f40d50c7c9d82e828479925c5e7efd48093e24335eb584b22208808dafc0fa8  model-00014.safetensors
2bf4e4dad356657e5c9adffbc7d9804f601e375c273c0787ca06c800adcdddea  model-00015.safetensors
f9a1e292d2ab4c17a201dd361370d4e66473bec2925e7202b09a9610343353e0  model-00016.safetensors
dadc39ceedd5f69a332529c15ad05b5377b4546bae00291ff41eb0c8738c95bd  model-00017.safetensors
d6561c71c20d3a52edf9160acbde5556ab4c573356bed9384956dfe82d1073a8  model-00018.safetensors
7184404a998d97cabdd3b402d56b929e4212dba1510f1d6ea1bbc2bbe327464c  model-00019.safetensors
3a3c54754c308d985d53bd63436b4a2ad7b2aca5528aad2e718fd6dd029f9cd3  model-00020.safetensors
ec19f17a01eec9d214bd0d9a062be41339706361ec9ec507361edb24def75b22  model-00021.safetensors
e6dfcdf4c86b7dea3280258d289b3cf2ba30cf95e389bf34fec652ce90dbd3c6  model-00022.safetensors
430c04f5dbd9680c112d993911fd3d5373d9be29dbd9497d1137906ff564e16e  model-00023.safetensors
88e00c56c56d169acd00866274a9650b8d99a1100aa5bac35520461a97293777  model-00024.safetensors
55a1afff2b11cde28da9f66fcb39490715322669126fa02e728c20b896b56fef  model-00025.safetensors
6f546e8dfef6f638b15432c67d6d78852cc745e34c0fdc5670e535f0da208d1d  model-00026.safetensors
52c35e849308b37812d10af10d9438c68180205dd4f2edac7e2e97416e214dd4  model-00027.safetensors
b600e661911aac6430fead492181fdfa8aedda1d96b0dc35fe287696d493e18e  model-00028.safetensors
040e9e81f1eaed3897b60fe12b1c3507c9568f1e1548aecac4e8aabe086087b2  model-00029.safetensors
78f84026058198a57be9c66054eb47c75c1cc6d4d6107ed3c21b8b2100d0286c  model-00030.safetensors
613b06e14da60b25a2e3d8ba615916149767dd9d9b3522b1b45543fd1668e8ec  model-00031.safetensors
cbc4d9e87c0dcb51a9257dff95a0c41caf836a12da5a98633208a90bc1e020e4  model-00032.safetensors
a2c5f8eefc72da008764d52559ed8a487d2e610ddd6aa8710913a4d79841ac77  model-00033.safetensors
b2e395c5bfee5972361f036e86f8c0d7431e9400ac5e820a8b4afc590b71c810  model-00034.safetensors
606297ec256d2911bd8fb1c4d45e00b8239c5908fa1542ee9a53466b8f7c9c57  model-00035.safetensors
ddb5184ea49fdd238ffc7d45f9c071c9778c5b2916f1600537bd98952809cb18  model-00036.safetensors
d5f2edf9b780fa2816832e5d72ae26a2a2f62a565cb05804b5e174ccb5b24cbd  model-00037.safetensors
0150b0b5e6d5c202fafeebb49ffc3d2298c657ba7f771d0b049e540809908e83  model-00038.safetensors
2faad08915e941419eb5a137b97ec83a665754951b7527732ccc50a7123d230e  model-00039.safetensors
ad15a68c5c5d0b637c859fac4acb624319a9292bb7442cada9d6bb4e6f3f5b0d  model-00040.safetensors
a1a01fa97ffcd1b00574c3c9b046da6e6c87cf8eacf62c5704544fba2a245f74  model-00041.safetensors
c3078dca364a7af8f742c1073111496c6edf6907674d1f465c342c20c8ca1d18  model-00042.safetensors
8d44b18ef58aac61eca71f138ab694df8083b22d277c5be7ffd0e2695a2f5b1b  model-00043.safetensors
c879b6796a353ac0bca9c02dd94c4b239ab8ef573c8b9d8a7dd949d11bf8c1ca  model-00044.safetensors
a79798aa4e6a78ab60231a3423881c6b8a736eca58ea808062729d767f94cf72  model-00045.safetensors
8810e21edaca29c24a224bad71fa30698c8cc64d75539061642968bb17deb073  model-00046.safetensors
0124836975b23f77f61d9ad4e6dee82d473df3339a2bb7fc8a8d429e4b399a7e  model-00047.safetensors
d8a66e75af6e98a490bf41142f2193993a6450cb80f04fbda40ee264f5cde7d6  model-00048.safetensors
c77a985728c672f5ae246e2e396dd4e4588e5a5ed5331f91c35d14a2d01a505b  model-00049.safetensors
1722696afffa2e0f139dac8e876027173c8fdc1ec298d38090734c3a9cc45d2d  model-00050.safetensors
4a7640416ca85716a871d9471cd89cf643f0642e4979fd1379b3955689b613b5  model-00051.safetensors
6058a9c6a716ff21689b1cb38a202ad044d43774a79e919e8de79a344a00c48b  model-00052.safetensors
38fcb750d96efc62264d1739782d676afc0c2f6351e02b57f7399ddf78357f78  model-00053.safetensors
0dd41b16fed1ed41a0288fb584da986f40fec547735c869658ac6650894e6cca  model-00054.safetensors
8617bc42c1e1d7fec8bcdd55facdd9903d77238bd2238a74b648859a958ffa26  model-00055.safetensors
5c7b55daa1ebd9ccaed48dba14ecdd6b0a20a3968fcbdb186ecb9930ef2d45f9  model-00056.safetensors
a4dad9ae1e993704c5b3e5f0d1f8aff98c6845fb55104399b33a4ff958eccc2d  model-00057.safetensors
efdb6b4f2c7ec0d663cf453735df090df840ab09963c1a10ffbfe644daebb410  model-00058.safetensors
b5b38d0597016cdb547534809e18da06b87399a626703cdf593ddafd70c2a436  model-00059.safetensors
eb371c9417a54a11e412aca37d3fbf3783dc4d6cfd261814879e338439505ff2  model-00060.safetensors
b00f07e42b1d99dab200150fb67cbb1f6b04f05398e697c5f770cb35a6005743  model-00061.safetensors
44cf5b9547ba9fc1eeb58d49df6e13234cd7e2a00f056274dc63063778b28e12  model-00062.safetensors
96061c07831c2b30b92c979cb53014d412bea80503b84adcc31264ef15f91ae9  model-00063.safetensors
d8d952fd60fad3ef9a5e930846ccdba540262b14e587182c0e966e639bcf21fb  model-00064.safetensors
82656cb38c12842467e5e35be360f184f838e9c0014c3e3e5d75f2c46e83a30f  model-00065.safetensors
1408ecaef6486ca88a1aa0212b349870bb53ac976f70059e66af117e2947e5da  model-00066.safetensors
642c25e17d1094ca1f166c58729cbe167e706f52ca3f5da2813f402e865799b1  model-00067.safetensors
d2e7a631dccf098a4f87dacbbf1bf5ee31cdb81a3ebcfbe5923232f72072b105  model-00068.safetensors
aa1814ed3b3b83609706c3a0deb649cce092d702d951fdf933580ed6cf135a07  model-00069.safetensors
49f64170c648101267e00e7792995f3eb2ebde32f32c4327a2e7b29e8220ded1  model-00070.safetensors
d8bde391a5f892da5f9b29ae4e4189801970b5b445c584ec8acde11677bc96d1  model-00071.safetensors
fbe4b7d54ac848980c760d496c5c1f65ed8ce63be5bb77d2a21a4848b5968a0e  model-00072.safetensors
441999f7292ca274cfbc5991473152e63d40acc3a66664537ac27c1da9444b99  model-00073.safetensors
26c58e02d0d8dc51d891f439933248f0f6343a12eb2e98b858c9864c7c5e4592  model-00074.safetensors
4adcaf6b737f7c63abd307fcf841b6edd887c654115d27ea5bdd1ea94e373f25  model-00075.safetensors
650eeaa0fc5595d5cd9e402cb562c32e39a595adf1dba51e0f986c67b60e7753  model-00076.safetensors
88dad0285a3424f5dccbd723634bdca494748277f4f28ccee20fe95b14082386  model-00077.safetensors
80936a886b06e758c149d80c0d4e8d5acd18ea0a6c98fcf85a71941893f52d05  model-00078.safetensors
de60967b14c0ce6b234e98b1959b9ea08e5e37b5da1ba361c2a9f36a6ee65c15  model-00079.safetensors
2ae5ffef7d84c11a1f725664d84e1679d122181185f4cf1e9dfe6b7e8e06ef44  model-00080.safetensors
d32c837757a0f77a8c4ca8bb3c3fa044e370d6072ccf0fe1060bb333a8865890  model-00081.safetensors
56ca3bc85be5174e049e3c71b765c3d6b29a83ee36a0173d2be0b1fccc886a32  model-00082.safetensors
af22991c93769b3175c2b4c916deced1805138a91606fec21c92621e1aad3ae8  model-00083.safetensors
02355741d70992f3728694f247380af61169b07c1ad3486ac6603f1473a743d6  model-00084.safetensors
4b8762e444fbb6f7ef3cbdc226a38f2c7b27230975456ccf0dd32c520e71cfae  model-00085.safetensors
e925bc25d6d993918ee4bb3c97d23cc452051791a857760f45d20ee09fb2b7d8  model-00086.safetensors
ce020c380de7630712a9f7dccd569d2ef012bec481be11c764593704413e9577  model-00087.safetensors
3e7166cbd32a3ed3bdf8db49e15f47b944dcc79800caa9db052bd4a9d0e6818d  model-00088.safetensors
a9619ec23a1a032bdb103afa00cf7beea563a13fcd33c75980b70d032adb01c3  model-00089.safetensors
3d26f4a943485d35b685668e65e9bba06e253083a19821ccb276461d66fb2341  model-00090.safetensors
30793ae9c7c11d9793b7d180f9d8e9c8f86c0f9524fdc79bb26ae10599778090  model-00091.safetensors
1d105cb61e6fe8d7dbde81aca3f7d89fa6fc85c5198dea3dcc6631c5afb02326  model-00092.safetensors
2fb70976d4b3f4259867e1295f62099df0f3c079c128fc1d8e1783fc5208777c  model-00093.safetensors
cea8946b7e40054c79173073f0668b905c09553c837eaa7e3ff58062b0170541  model-00094.safetensors
acd929a330d422e87672733ddebf58eca7e452791d4c5ca2a8f5f66b958883e4  model-00095.safetensors
dea797e3c1004e54aaf28014cce210f8461730dc7203abac451ec4b8b472c011  model-00096.safetensors
f239a5106ef2c8d44823493b8a10d4d8527c6cc4a8623af2ba1ebdcb1b73d114  model-00097.safetensors
66820281a7ba9f2f48417d9d45505a24e7e336f0d4e1cbcafaec28b4db5e077c  model-00098.safetensors
5a0db0dba5c379d1e24532abe56ca92c83d158bb4a1f23e690a630d621b31314  model-00099.safetensors
6518523a9d5ed8ad59a0a19f08ad1eb2a5e0d30aab38b8c52e9089b8a495671d  model-00100.safetensors
bba0b8dd7d32f2295a422bc61ddcf3101d0136a12511e33fa776e716278359fe  model-vision.safetensors
c8ab74bc343408cf3923d7d64b3698fbeb3e78c07ce7f85a650a8278731251d2  ngram_table.bin
0997f410c57a1f4e53b09e4be8f4a172d90edd9564368fb0847030937229b9f3  tokenizer.json
"

# ---- serving --------------------------------------------------------------
MODEL_ALIAS_DEFAULT="mlxserve-flash-next-mixed-4-8bit"   # stable id at /v1/models
DEFAULT_PROFILE="agent"
DEFAULT_PORT=8011                         # clear of the MTPLX sibling's 8010 and mlx-serve's own 11234

# The checkpoint's generation_config.json at this revision: temperature 1.0,
# top_p 0.95, top_k 20. Passed explicitly so the launch line says what runs.
SAMPLING_THINKING="--temp 1.0 --top-p 0.95 --top-k 20"
# The MTPLX sibling's instruct preset, minus its presence penalty: mlx-serve
# accepts presence_penalty per request but has no server-side default for it.
SAMPLING_INSTRUCT="--temp 0.7 --top-p 0.80 --top-k 20"

# Reasoning effort cannot be set server-side on mlx-serve. The template reads
# xhigh|medium|low and raises on anything else; mlx-serve maps a request that
# names no effort to "low" with a 2048-token thinking budget (source:
# chat.zig qwen38EffortFor, server.zig implicitEffortBudget; 26.9.5
# changelog). OpenCode sends no effort, so "low" is what it gets. The launcher
# refuses any other value rather than pretend to apply it.
REASONING_EFFORT_DEFAULT="low"
REASONING_EFFORTS="default low"

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="mlxserve"
CONTEXT_LIMIT=131072                      # must match the default profile's ctx
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------
low_memory_advice() {
  local mem="$1"
  warn " This pack is ~70 GiB of weights (ESTIMATED from its file sizes) plus"
  warn " KV cache and working memory; ${mem} MiB of GPU-addressable memory is not enough."
  warn ""
  if (( mem >= 50000 )); then
    warn " On a 64 GB Mac, the author publishes a 3.3-bit pack (52 GB resident per"
    warn " mlx-serve's 26.9.3 changelog) that this repo has no combination for, or use:"
    warn "   ./install-qwen-3.8-27b-macos-64GB-mtplx-opencode.sh"
  fi
  warn ""
  warn " Do not raise iogpu.wired_limit_mb to force it: unified memory is the"
  warn " constraint, and a 128 GB Mac already kernel-panicked on this model class."
}

combination_performance() {
  cat <<'TXT'
NOT MEASURED BY THIS REPO. The model author's figures, from the pack's card
(M4 Max 128 GB, mlx-serve 26.8.11):
  resident            ~75 GB
  decode, serial      ~60 tok/s
  decode, MTP         78 tok/s  (+41% on code, a few percent slower on prose)
  prefill             ~730 tok/s
mlx-serve 26.9.3 changelog (M4 Max): this 4-8 bit pack 54.3 -> 56.3 tok/s.
None of these were taken on an M5, in an agent session, or by this repo.
TXT
}

combination_troubleshooting() {
  cat <<'TXT'
Refused: another server   stop MTPLX/llama-server/the MLX-Serve app first
Refused: memory           close large apps; never raise iogpu.wired_limit_mb
Client errors at start    the model is still loading; wait for /v1/models "ready"
No thinking               THINKING=0 set? check served/<id>/generation_config.json
Effort seems fixed        it is: mlx-serve serves an unnamed effort as 'low'
Long prompts spike memory the card: past ~64k use a smaller --prefill-chunk (no value given)
TXT
}
