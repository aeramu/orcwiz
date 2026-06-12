# Orcwiz 🧙‍♂️

Orcwiz is an AI Agent Orchestration Tool built in Rust. It acts as a bridge between your task tracker (Linear) and your AI coding agent (`opencode`). It automatically polls for new tasks, sets up the workspace, dispatches the AI to complete the work, and tracks the execution history in a web dashboard.

## Features

- **Automated Linear Polling:** Continuously fetches "unstarted" tasks assigned to you.
- **Smart Workspace Setup:** Automatically parses git URLs from the task description and clones the repositories if they don't exist locally.
- **Agent Orchestration:** Spawns `opencode` to execute the task in the appropriate project directory, with instructions to move the task to 'Ready to Review' upon completion.
- **Web Dashboard:** An embedded Axum web server (`http://localhost:3000`) provides a UI to monitor running sessions and view session history.
- **Background Daemon:** Easy installation commands to run Orcwiz silently in the background on macOS (via `launchd`), Windows (via Windows Services), and Linux (via `systemd`).

## Installation

### Prerequisites

- [Rust & Cargo](https://rustup.rs/)
- [opencode CLI](https://opencode.ai) installed and available in your `$PATH`
- A [Linear API Key](https://linear.app/settings/api)

### Build from Source

```bash
git clone https://github.com/your-username/orcwiz.git
cd orcwiz
cargo build --release
```

## Configuration

When you run Orcwiz for the first time, it will generate a default configuration file.

- **macOS / Linux:** `~/.config/orcwiz/config.json`
- **Windows:** `%APPDATA%\orcwiz\config.json`

Open the configuration file and configure the settings:

```json
{
  "linear_api_key": "YOUR_LINEAR_API_KEY_HERE",
  "projects_dir": "/Users/your_username/dev",
  "port": 3000,
  "linear_team_id": null,
  "opencode_server_url": "http://localhost:4096"
}
```

### Configuration Fields

- **`linear_api_key`**: Your Linear API token.
- **`projects_dir`**: The parent directory where projects are cloned and run.
- **`port`**: The port for the Orcwiz local web dashboard (default: `3000`).
- **`linear_team_id`**: (Optional) Filter tasks by a specific Linear Team ID.
- **`opencode_server_url`**: (Optional) The URL of an existing, running `opencode` server (e.g. started via `opencode serve` or `opencode web`). If configured and responsive, Orcwiz will run tasks by attaching to this server using the `--attach` flag. If it is unreachable or offline, Orcwiz falls back to starting a local `opencode` process.

## Usage

### Start the Orchestrator Manually

To run the orchestrator and web server in your terminal:

```bash
orcwiz start
```
You can now access the web dashboard at `http://localhost:3000`.

### Install as a Background Service

If you want Orcwiz to run silently in the background automatically:

```bash
orcwiz install
```
*Follow the on-screen instructions for your specific OS to activate the daemon.*

### List Local Sessions

To quickly check the status of your tasks from the CLI:

```bash
orcwiz sessions
```

## How It Works

1. **Poll:** Every 60 seconds, Orcwiz queries the Linear GraphQL API for tasks assigned to you in the "unstarted" state.
2. **Setup:** It checks the task description for a Git URL or local folder path. If a Git URL is found, it clones it into your `projects_dir`.
3. **Execute:** It runs `opencode run "..."` in the target directory, passing along the task details.
4. **Track:** The output is captured, the generated `opencode` session ID is extracted, and the state is saved to a local SQLite database (`~/.local/share/orcwiz/orcwiz.db`).
5. **View:** When you click "View History" in the web dashboard, Orcwiz streams the task history directly from `opencode export <session_id>`.

## License

MIT License
