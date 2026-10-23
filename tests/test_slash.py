from orb import slash


def test_parse_takes_the_name_and_the_rest():
    assert slash.parse("/vikunja-todo") == ("vikunja-todo", "")
    assert slash.parse("  /hours  last week ") == ("hours", "last week")
    assert slash.parse("/design:accessibility-review page.html") == ("design:accessibility-review", "page.html")


def test_paths_and_plain_text_are_not_commands():
    assert not slash.is_command("look at /Users/x")
    assert not slash.is_command("hello")
    assert not slash.is_command("/")
    assert not slash.is_command("// comment")


def test_local_commands_are_the_dashboards_own():
    assert slash.local_command("/clear") == ("clear", "")
    assert slash.local_command("/Model opus") == ("model", "opus")
    assert slash.local_command("/vikunja-todo") is None
    assert slash.local_command("clear") is None


def test_merge_puts_local_first_and_drops_duplicates_and_terminal_ones():
    items = slash.merge([{"name": "clear", "description": "cli clear"}, "vikunja-todo",
                         {"name": "doctor"}, {"name": "_internal"}, {"name": "statusline"},
                         {"name": "/hours", "description": "x" * 500}], terminal=["/statusline"])
    names = [i["name"] for i in items]
    assert names[: len(slash.LOCAL)] == [c["name"] for c in slash.LOCAL]
    assert names.count("clear") == 1 and items[0]["local"]
    assert "vikunja-todo" in names and "hours" in names
    assert "doctor" not in names and "_internal" not in names and "statusline" not in names
    hours = next(i for i in items if i["name"] == "hours")
    assert len(hours["description"]) == slash.DESCRIPTION_MAX and hours["description"].endswith("…")


def test_merge_without_cli_is_just_local():
    assert [i["name"] for i in slash.merge(None)] == [c["name"] for c in slash.LOCAL]


def test_history_shows_the_command_as_typed():
    stored = "<command-message>hours</command-message>\n<command-name>/hours</command-name>\n<command-args>last  week</command-args>"
    assert slash.from_transcript(stored) == "/hours last week"
    assert slash.from_transcript("<command-name>/clear</command-name>") == "/clear"
    assert slash.from_transcript("plain text") is None


def test_settings_commands_are_blocked_and_hidden():
    assert slash.blocked("/config permissionMode=acceptEdits") == "config"
    assert slash.blocked("/Usage-Credits") == "usage-credits"
    assert slash.blocked("/configure-thing") is None and slash.blocked("/vikunja-todo") is None
    items = slash.merge(["config", "auto-mode-setup", "usage-credits", "extra-usage", "hours"])
    names = {i["name"] for i in items}
    assert names & slash.BLOCKED == set() and "hours" in names
    assert [i for i in items if i["name"] == "config"][0]["local"]  # the dashboard's own, not Claude Code's


def test_config_changes_only_known_repo_settings():
    assert slash.local_command("/config permissionMode=plan") == ("config", "permissionMode=plan")
    assert slash.parse_config("permissionmode=PLAN model=Opus") == ({"permissionMode": "plan", "model": "opus"}, [])
    assert slash.parse_config("") == ({}, [])
    changes, problems = slash.parse_config("model=opus permissionMode=acceptEdits theme=dark")
    assert changes == {} and len(problems) == 2  # one bad key changes nothing at all
