# Orcwiz 🧙‍♂️

Orcwiz is an in-house CLI Kanban Board and AI Agent Orchestration Tool built in Rust and SolidJS. It allows you to manage tasks locally and dispatch the AI coding agent (`opencode`) to execute them in your workspaces. It features a fast CLI and a beautiful, drag-and-drop web dashboard.

## Features

- **In-House Kanban Board:** Create and manage your tasks without relying on external services. Track tasks across `Backlog`, `To Do`, `In Progress`, `Review`, and `Done` states.
- **Agent Orchestration:** Automatically dispatches `opencode` to execute tasks that are queued up, running them directly in your specified local project paths.
- **CLI Management:** Add tasks, view the board, and manually trigger orchestrations straight from your terminal.
- **Beautiful SolidJS Web Dashboard:** A sleek, mobile-responsive, dark-themed Kanban web UI built with SolidJS and TailwindCSS. Features HTML5 drag-and-drop for task management.

## Installation

### Prerequisites

- [Rust & Cargo](https://rustup.rs/)
- [Bun](https://bun.sh/) (for building the SolidJS frontend)
- [opencode CLI](https://opencode.ai) installed and available in your `$PATH`

### Build from Source

First, build the SolidJS frontend:

```bash
cd web
bun install
bun run build
cd ..
```

Then, compile the Rust backend:

```bash
cargo build --release
```

## Configuration

When you run Orcwiz for the first time, it will generate a default configuration file.

- **macOS / Linux:** `~/.config/orcwiz/config.json`
- **Windows:** `%APPDATA%\orcwiz\config.json`

Open the configuration file and configure the settings:

```json
{
  "projects_dir": "/Users/your_username/dev",
  "port": 3000,
  "opencode_server_url": "http://localhost:4096"
}
```

### Configuration Fields

- **`projects_dir`**: The parent directory where projects are cloned and run.
- **`port`**: The port for the Orcwiz local web dashboard and API (default: `3000`).
- **`opencode_server_url`**: (Optional) The URL of an existing, running `opencode` server (e.g., started via `opencode serve` or `opencode web`). If configured and responsive, Orcwiz will run tasks by attaching to this server using the `--attach` flag.

## Usage

### Start the Orchestrator and Web Dashboard

Run the server in the background or in a separate terminal. This will serve the SolidJS Kanban UI and begin processing tasks queued for execution:

```bash
orcwiz start
```
You can now access the interactive drag-and-drop web dashboard at `http://localhost:3000`.

### CLI Commands

You can interact with your Kanban board directly from the terminal via the HTTP API:

- **View the Board**:
  ```bash
  orcwiz board
  ```

- **Task Management**:
  ```bash
  orcwiz task add "Implement Login" "~/dev/my-project" "Move login logic to auth module"
  orcwiz task info <task_id>
  orcwiz task run <task_id>
  orcwiz task set-status <task_id> "done"
  ```

## How It Works

1. **Kanban Database:** Tasks are stored in a local SQLite database (`~/.local/share/orcwiz/orcwiz.db`).
2. **Web API:** The Rust Axum server provides endpoints at `/api/tasks` for the CLI and the frontend dashboard to communicate with.
3. **Frontend:** The SolidJS application in `/web` is compiled and served statically via the Axum backend on port 3000.
4. **Execution Loop:** The background loop in `orcwiz start` constantly checks for tasks in the `todo` state. When found, it runs `opencode run "..."` in the target `project_path`, passing along the task details, and shifts the task into `in_progress`.
5. **Session Tracking:** The `opencode` session ID is extracted and saved to the database.

## License

GNU License
