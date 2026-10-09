# Start here: moving the Utility Ops app to Claude Code

This folder is the starting point for the project. Claude Code automatically reads `CLAUDE.md`,
which contains the full project brief from our Claude.ai conversation, so you don't need to explain
the project again.

## What's in this folder

- `CLAUDE.md`: the project brief Claude Code reads automatically
- `seed_data/`: equipment, failure modes, PM tasks, standards and register layouts extracted from your spreadsheets
- `source_files/`: your original spreadsheets
- `public/chivita-logo.png`: the logo used on every page

## Steps on your other laptop

1. **Unzip** this folder somewhere easy to find, e.g. `Documents\utility-ops`.
2. **Install Git** if you're on Windows: https://git-scm.com/downloads/win (default options are fine).
   Claude Code uses it to keep a history of every change, so mistakes can be undone.
3. **Open the Claude desktop app** and sign in with the same account you use here.
4. Click the **Code** tab at the top.
5. In the prompt box, set:
   - **Environment:** Local
   - **Project folder:** the `utility-ops` folder you unzipped
   - **Permission mode:** Plan (Claude proposes a plan first and writes no code until you approve)
6. Paste the first message below and press Enter.

You don't need VS Code. If Claude needs Node.js or another tool installed, it will tell you what to install.

## First message to paste

> Read CLAUDE.md, then look through seed_data/ and source_files/. Before writing any code:
> 1. Summarise the project back to me in plain language so I can confirm you understood it.
> 2. List the questions you need answered, including any conflicting equipment standards you find.
> 3. Propose the plan for Phase 1 (screens, database tables, what I'll be able to test at the end),
>    and tell me what accounts I need (Supabase, Vercel, GitHub) and anything that costs money.
> Initialise a git repository first so every change is tracked.

## Tips

- **Review in the Browser pane.** Claude can run the app and show it to you there. Click through it
  and type what you'd change.
- **Switch to "Accept edits" once you approve a plan**, so Claude can work without asking for every file.
- **Add new information as it arrives** by dropping the file into the folder and telling Claude, e.g.
  "I've added staff_list.xlsx — import it". That applies to the names list, the consumption
  template and the PowerPoint template.
- **Long sessions:** if Claude's context fills up it summarises automatically. Starting a new session
  is fine too, because `CLAUDE.md` and the code carry the project forward.
