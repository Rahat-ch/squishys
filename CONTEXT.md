# Squishys

A Claude Code mod that gives every agent the orchestrator starts a tiny pixel-art squishy, and lets the user watch and steer those agents through them.

## Language

### Agents

**Orchestrator**:
The main Claude Code session that starts agents.
_Avoid_: main agent, lead, parent

**Agent**:
Any in-process agent the orchestrator starts: a subagent, fork, background agent or in-process teammate. Split-pane teammates and workflow agents are not agents in this sense.
_Avoid_: worker, task, subagent (when the broader meaning is intended)

**Main view**:
Claude Code's own transcript area, showing the orchestrator or whichever agent the user opened through Claude Code. Squishys can see what is in it but never changes it.
_Avoid_: main panel

### Squishys

**Squishy**:
The pixel-art character assigned to one agent, which represents that agent for the agent's whole life.
_Avoid_: sprite, avatar, pet, icon

**Part**:
One interchangeable piece of a squishy's look: a body, face, palette or accessory.
_Avoid_: layer, trait

**Kit**:
The full set of drawn parts that squishys are assembled from.
_Avoid_: catalog, sprite sheet

**Species**:
A squishy's kind, set by its body and face. Species are what the Squishydex counts toward completion.
_Avoid_: type, breed, model

**Variant**:
A squishy's palette and accessory within its species. Collected in the Squishydex but not needed to complete it.
_Avoid_: skin, form, color

**Rarity**:
How seldom a part or squishy turns up: common, uncommon or rare.
_Avoid_: tier, drop rate

**Legendary**:
One of a handful of unique squishys drawn whole rather than assembled from the kit, each with a fixed name and extremely low odds of appearing.
_Avoid_: mythic, boss, rare (rare is a rarity)

**Shiny**:
A very rare roll that gives any squishy a special palette and sparkle, independent of its rarity.
_Avoid_: golden, special

**Partner**:
The user's own squishy, which stands for the orchestrator. The user picks it, and it stays the same from session to session.
_Avoid_: trainer, main squishy

**Starter**:
One of the three fixed species offered to a new user when they choose their first partner.
_Avoid_: default, preset

**Name**:
The cute generated name a squishy carries, derived from its parts and separate from its agent's description.
_Avoid_: label, title

**Squishydex**:
The user's lasting collection of every distinct squishy they have met, kept across sessions.
_Avoid_: collection, gallery, history

### Squishy states

**Working**:
A squishy whose agent is running tools or waiting on a model.
_Avoid_: active, busy

**Thinking**:
A squishy whose agent is streaming a model response right now.
_Avoid_: typing, talking

**Needs you**:
A squishy whose agent is blocked waiting on the user, such as for a permission prompt.
_Avoid_: blocked, waiting, alert

**Asleep**:
A squishy whose agent has finished normally.
_Avoid_: dead, inactive, idle, done

**Squished**:
A squishy whose agent failed or was stopped.
_Avoid_: dead, killed, errored

### The pane

**Pane**:
The Squishys panel inside Claude Code, separate from the main view.
_Avoid_: side panel, sidebar

**Roster**:
The pane mode that shows the current squishys side by side.
_Avoid_: grid, list, party

**Slot**:
One of the limited places in the roster where a squishy can appear.
_Avoid_: tile, cell

**Band**:
The compact strip of mini squishys above the prompt, used when the pane can't open.
_Avoid_: bar, strip, mini roster

**Overflow**:
The agents that currently have no slot, shown in the roster only as a count.
_Avoid_: queue, backlog, hidden

**Settings**:
The pane mode where the user changes the lasting options, such as the model default for new agents and the slot cap.
_Avoid_: preferences, config

**Focus view**:
The pane mode given over to one agent's live activity and controls, reached by picking its squishy.
_Avoid_: detail view, main panel, expanded view

**Redirect**:
A message the user types in an agent's focus view, which the agent reads at its next step, or which resumes it if it had ended.
_Avoid_: message, steer, nudge
