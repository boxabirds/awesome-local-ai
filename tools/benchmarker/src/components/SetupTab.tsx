/** How to make a machine a benchmark node, and what access each part needs. Static text: the steps come from
 * tools/dbench/README.md and benchmarks/spec-bench/harness/setup-node.sh, which have the details. */
export function SetupTab() {
  return (
    <article className="setup">
      <h1>Make a machine a benchmark node</h1>
      <p>A node is a machine that runs benchmark jobs. It runs <code>dbench serve</code>, a small service with a job queue; this page
        and the <code>dbench</code> command line talk to it over your Tailscale network. Each job runs the harness, which drives the
        coding agent story by story, scores each story, and pushes the run's record to GitHub.</p>

      <h2>What access it needs</h2>
      <table className="access">
        <thead><tr><th>Who</th><th>Needs</th><th>Why</th></tr></thead>
        <tbody>
          <tr><td>The node</td><td>Tailscale, on the same tailnet as this Mac</td><td>This page reaches its dbench service at <code>http://&lt;name&gt;:7717</code></td></tr>
          <tr><td>The node</td><td>Push access to the public repo (<code>boxabirds/awesome-local-ai</code>)</td><td>The harness commits and pushes each run's record after every story. Everything it pushes is public.</td></tr>
          <tr><td>The node</td><td>Read access to the private suite repo (<code>awesome-local-ai-bench-private</code>)</td><td>The held-out tests the agent never sees. Ask the owner for access.</td></tr>
          <tr><td>This Mac</td><td>The node's dbench token</td><td>Kept in <code>~/.config/dbench/nodes.toml</code> (mode 600). Machines → Add reads it over SSH if it can, or asks you to paste it.</td></tr>
          <tr><td>This Mac (optional)</td><td>SSH to the node (Tailscale SSH or a key)</td><td>Only so Add can fetch the token by itself</td></tr>
          <tr><td>A cloud reference stack</td><td>A Claude subscription token on the node</td><td>Saved by <code>benchmarks/reference/save-claude-token.sh</code></td></tr>
        </tbody>
      </table>

      <h2>Steps</h2>
      <ol className="steps-list">
        <li><b>Tailscale.</b> Install it on the node and join your tailnet. Note its name (MagicDNS) and its <code>100.x.y.z</code> address.
          A Windows GPU PC: run <code>tools/windows-bench-host/setup.ps1</code>, which does Tailscale, SSH and WSL2, then do the rest inside WSL2.</li>
        <li><b>The repos.</b> Clone <code>awesome-local-ai</code> (with push access) somewhere stable, e.g. <code>~/awesome-local-ai</code>.</li>
        <li><b>Tools and the private suite.</b> From the repo run <code>benchmarks/spec-bench/harness/setup-node.sh</code>. It checks the tools the
          harness needs (git, Node via nvm, uv, the agent client at its pinned version) and says how to install anything missing; clones the
          private suite next to the repo at the pack's pinned version; installs the suite's dependencies and Playwright's Chromium; and proves the
          agent's sandbox can't see the held-out tests. For a Claude reference stack add <code>--stack benchmarks/reference/vidi/opus-5.5</code>.</li>
        <li><b>dbench.</b> Build it (<code>cd tools/dbench &amp;&amp; cargo build --release</code>, or <code>./build-linux.sh</code> on a Mac for a Linux node) and put
          the binary in <code>~/.local/bin</code>. Then install it as a service bound to the node's Tailscale address:
          <pre>{`# Linux (systemd user service)
dbench service-unit --kind systemd --bind 100.x.y.z:7717 --repo ~/awesome-local-ai \\
  > ~/.config/systemd/user/dbench.service
systemctl --user daemon-reload && systemctl --user enable --now dbench
sudo loginctl enable-linger $USER     # keeps it running with nobody logged in, and at boot

# macOS (launchd agent)
dbench service-unit --kind launchd --bind 100.x.y.z:7717 --repo ~/awesome-local-ai \\
  > ~/Library/LaunchAgents/com.awesome-local-ai.dbench.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.awesome-local-ai.dbench.plist`}</pre>
          On first start it writes its token to <code>~/.dbench/token</code>. Add <code>--path-prepend</code> for the Node and tool directories the jobs need
          (the unit records the PATH of the shell that generated it).</li>
        <li><b>A combination.</b> Install at least one: run its install script from the repo, e.g.
          <code>./install-qwen-3.8-swift-1.5-27b-ubuntu-nvidia4090-llamacpp-pi.sh</code>. It downloads the model and engine and writes
          <code>~/.local/share/&lt;install-id&gt;/install.env</code>, which is what dbench offers under Machines → Queue a run.</li>
        <li><b>Add it here.</b> Machines → Add a machine: its Tailscale name (and the address, if not <code>http://&lt;name&gt;:7717</code>). The page checks it answers
          before saving it.</li>
      </ol>

      <h2>Good to know</h2>
      <ul>
        <li>A node runs one job at a time, in the order queued. A job that fails is restarted up to three times, then marked failed.</li>
        <li>Stopping a running job throws away the story in progress. Restart queues the same run again, which resumes at its first unfinished story.</li>
        <li>Restarting dbench doesn't stop a running job: it's adopted when dbench comes back.</li>
        <li>At the end of a run the harness saves the app's history (<code>workspace.bundle</code>) and re-scores the final build, so the run can be scored and judged.</li>
        <li>Details: <code>tools/dbench/README.md</code> and <code>benchmarks/spec-bench/harness/setup-node.sh</code>.</li>
      </ul>
    </article>
  );
}
