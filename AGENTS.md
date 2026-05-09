# AGENTS

## Overview

This file documents the agents, automation, and AI patterns used in the SPA-AI project.

## Current Agents/Patterns

### 1. State Management Agent

- Centralized app state in `app-state.js` using a reducer pattern.
- All components dispatch actions to update state.
- Components subscribe to state changes for reactive UI updates.

### 2. Event Mapping Helper

- `addMappedListeners` helper in `src/app-state.js` allows DRY, declarative event binding in all components.
- Promotes reusable, maintainable event handling patterns.

### 3. Component Encapsulation

- All UI logic is encapsulated in native web components with Shadow DOM for style and logic isolation.

## Extending Agents

- Document new automation or agent-like patterns here for future contributors.

## Contributing

- Please document any new agent, automation, or AI pattern added to the codebase.
