FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# Rename the base image's "node" user (UID 1000) to "agent".
# This keeps UID 1000 so that --userns=keep-id (Podman) and
# --user 1000:1000 (Docker) map to the correct home directory owner.
RUN usermod -d /home/agent -m -l agent node

# Install pnpm globally as root (matches host version) — this repo uses pnpm-lock.yaml.
RUN npm install -g pnpm@9.5.0

# Install Claude Code CLI as `agent` so the install script targets /home/agent/.local/bin
# and creates /home/agent/.claude with the right layout.
USER agent
RUN curl -fsSL https://claude.ai/install.sh | bash
USER root

# AFTER all installs are done, open up /home/agent for any UID/GID to write.
# Sandcastle's Docker provider runs the container with `--user $HOST_UID:$HOST_GID`
# (your host user's IDs) so bind-mounted worktree files get the right ownership
# on the host. On macOS the host UID is typically 501 — not 1000 — so the
# running container user does not own /home/agent. It needs write access to
# /home/agent/.gitconfig (for git's safe.directory hook) and to
# /home/agent/.claude/projects/ (for Claude Code's session JSONL files).
# Chmod must run AFTER any tool that creates files in /home/agent.
RUN chmod -R a+rwX /home/agent

USER agent

# Add Claude to PATH
ENV PATH="/home/agent/.local/bin:$PATH"

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at /home/agent/workspace
# and overrides the working directory to /home/agent/workspace at container start.
# Structure your Dockerfile so that /home/agent/workspace can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
