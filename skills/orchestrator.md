name: linear-task-orchestrator
description: Use when delegating tasks based on Linear issues. Handles triggering on status changes, planning, user confirmation, interactive adjustments, and sub-agent execution.
version: 1.0.0
author: Lexi Anugrah
license: MIT
metadata:
  hermes:
    tags: [orchestrator, linear, delegation, sub-agents, planning, interactive]
    related_skills: []
---

# Linear Task Orchestrator

## Overview
This skill defines the workflow for an interactive orchestrator agent that manages tasks derived from Linear issues. It triggers when a Linear card is moved to a specific state, gathers context, proposes a structured plan and task breakdown, and requires user sign-off before delegating work to specialized sub-agents.

## When to Use
- A user triggers the agent (e.g., by moving a Linear card to a specific board or status like "Agent Backlog" or "In Progress").
- You need to break down a complex Linear ticket into actionable sub-tasks.
- The workflow requires explicit human-in-the-loop confirmation and interactive refinement before execution begins.

## Prerequisites
- Access to the Linear API (to fetch issue details, add comments, change status).
- Capability to spawn and monitor sub-agents.
- A chat or interaction interface to request user confirmation and handle adjustments.

## Workflow

### 1. Trigger & Context Gathering
Initiate the workflow based on user action.
- **Detect Trigger:** Acknowledge when the user moves a card to the designated target board/status or explicitly invokes you with a Linear URL/ID.
- **Fetch Issue Details:** Retrieve the title, description, current status, labels, linked PRs, and comments from the Linear issue.
- **Extract Acceptance Criteria:** Clearly define what constitutes "done" based on the context.

### 2. Planning & Task Breakdown
Before taking any action, synthesize the context into a plan.
- **Draft an Implementation Plan:** Outline the technical or operational approach required to solve the issue.
- **Breakdown Tasks:** Divide the plan into distinct, isolated sub-tasks that can be individually delegated to sub-agents (e.g., "1. Investigate DB schema", "2. Update API endpoint", "3. Write unit tests").
- **Identify Dependencies:** Note which sub-tasks must be completed sequentially and which can be run in parallel.

### 3. Interactive User Confirmation (Human-in-the-Loop)
**CRITICAL:** Do not proceed to execution without explicit user approval.
- **Present the Plan:** Show the drafted plan and task breakdown to the user clearly and concisely.
- **Ask for Confirmation:** Explicitly ask, "Does this plan look correct, or would you like to make any adjustments?"
- **Iterate and Adjust:** If the user provides feedback or wants changes, update the plan accordingly and present the revised version for approval. Loop this step until the user gives a clear "yes" or "proceed".

### 4. Sub-Agent Delegation
Execute the approved plan.
- **Formulate Sub-Agent Prompts:** Translate the approved sub-tasks into strict, highly-contextualized prompts for your sub-agents. Do not rely on them to find starting points if you already know them.
- **Spawn Sub-Agents:** Execute the delegation sequentially or in parallel based on the plan's dependencies.

### 5. Monitoring and Synthesis
As sub-agents complete their work, orchestrate the results.
- **Review Output:** Verify that the sub-agents met the specific goals of their delegated tasks.
- **Handle Failures:** If a sub-agent fails, adjust its prompt with more context or correct the error, and re-delegate. Ask the user for help if you are fundamentally blocked.
- **Synthesize Results:** Combine the output into the final deliverable (e.g., a cohesive PR, a research document).

### 6. Linear State Synchronization
Update the source of truth once the user-approved plan is complete.
- **Add Comments:** Post a summary of the completed work and links to generated artifacts (PRs, documents) on the Linear issue.
- **Update Status:** Transition the Linear issue to the appropriate completion state (e.g., "Ready to Review").

## Output Format
When presenting the plan to the user for confirmation (Step 3), you MUST use the following structured Markdown format to ensure uniformity:

```markdown
### 🎯 Goal
[Brief summary of the issue and what constitutes completion]

### 🔍 Context
[Key findings from the Linear issue, relevant linked PRs, and current repository state]

### 📋 Implementation Plan
- **Step 1:** [Description of action]
- **Step 2:** [Description of action]

### 🤖 Sub-Task Delegation
1. **[Task Name]**
   - **Delegation:** [Which sub-agent or role will handle this]
   - **Details:** [Specific instructions and context passed to the sub-agent]
2. [Task Name]...

### ❓ Open Questions
[Any questions or clarifications needed from the user before proceeding, or state "None" if clear]
```

## Common Pitfalls
1. **Skipping Confirmation:** Proceeding directly to delegation without waiting for the user to approve the plan. This can waste significant time and compute if the orchestrator misunderstood the Linear ticket.
2. **Being Rigid with Adjustments:** Failing to properly incorporate user feedback during the interactive planning phase. If the user says "skip step 2", the plan must strictly reflect that.
3. **Vague Task Breakdown:** Creating sub-tasks that are too broad (e.g., "Fix the bug"). Sub-tasks must be concrete (e.g., "Locate null pointer exception in `auth.ts` and add fallback").
4. **Losing Linear Context:** Forgetting to pass the overarching acceptance criteria down to the sub-agents, resulting in code that works but doesn't solve the specific user story.

## Verification Checklist
- [ ] Context fully gathered from Linear upon trigger.
- [ ] Concrete plan and sub-task breakdown generated.
- [ ] Plan presented to the user for explicit confirmation.
- [ ] User feedback interactively incorporated into the plan (if any).
- [ ] Execution only started AFTER explicit user sign-off.
- [ ] Sub-agent outputs verified and synthesized.
- [ ] Linear issue updated with summary and new status.