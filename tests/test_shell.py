import pytest

from orb.shell import read


def test_read_only():
    assert read("git -C ../x log --oneline && ls -la | head").read_only
    assert read("git branch -a; git remote -v; grep -rn foo src").read_only
    assert read("git --no-pager log --oneline -20 --stat && find src -name '*.py' -type f | head -n 5").read_only
    assert read('grep -rn --include="*.ts" "a b" src/*.ts && find . -name "*.py"').read_only
    for cmd in ("git branch new", "git -c core.pager=x log", "git diff --output=f", "find . -delete",
                "ls #\nrm -rf x", "ls # x\nrm x", "ls\rrm x",
                "sort -o f a", "echo x > f", "cat $(ls)", "npm test", "sed -i s/a/b/ f",
                "cat a & rm b", "cat a &rm b", "rg --pre ./x foo", "find . -fls out", "sort -uo f a", "tree -o f",
                "find . -name *", "git log --ou*", "cat *", "grep -rn --include=*.ts x .",
                "git branch -D x", "git branch --unset-upstream", "git tag -d v1", "git diff --ext-diff",
                "(rm a)", "cat a\\\nrm b", 'find . -"delete"', "rg foo", "uniq a b", "jq . a",
                "git -c x=y log", "git --exec-path=/x log", "git log --outp=f", "git diff --ext", "git --git-dir=x log",
                "ls --hostname-bin=x", "grep --pre=x foo", "cat a\nrm b"):
        assert not read(cmd).read_only, cmd


@pytest.mark.parametrize("cmd", [
    "git status #\nrm -rf x",  # "#" is not a comment to the reader, so a newline after it still counts
    "git log\nrm x", "git log; rm x", "git log && npm i", "git log | sh",
    "git log > f", "git log $(rm x)", "git log `rm x`", "git log ~/x", "git add *", "git add -- -*",
    "git -c core.hooksPath=x commit -m y", "git --git-dir=/x commit -m y",
])
def test_words_fail_closed(cmd):
    words = read(cmd).words
    assert words == () or words[0] != "git" or words[1] in ("-c", "--git-dir=/x"), (cmd, words)
    assert not read(cmd).read_only or cmd.startswith("git log"), cmd


def test_carriage_return():
    assert not read("git log\rrm x").read_only
    # norm turns \r into a space, so the words split more finely than bash does (bash keeps "log\rrm" as one word):
    # a grant then sees more words than run, never fewer
    assert read("git add .\rrm x").words == ("git", "add", ".", "rm", "x")


def test_words_keep_quoted_text_as_one_word():
    assert read('git commit -m "fix: login; and #2"').words == ("git", "commit", "-m", "fix: login; and #2")
    assert read("git  commit   -m 'a  b'").norm == "git commit -m 'a b'"  # norm collapses whitespace runs
    assert read('git commit -m "$(rm x)"').words == ()  # "…" still expands $( )


def test_heredoc_commit():
    cmd = "git commit -s -m \"$(cat <<'EOF'\nfix: login\n\nCo-Authored-By: x\nEOF\n)\""
    assert read(cmd).heredoc_commit == (("-s",), "fix: login\n\nCo-Authored-By: x")
    assert read(cmd).words == ()  # never a plain command
    assert read(cmd + " && rm x").heredoc_commit is None
    assert read(cmd.replace("'EOF'", "EOF")).heredoc_commit is None  # an unquoted heredoc expands
    early = cmd.replace("fix: login", "fix\nEOF\n)\"; rm -rf ~; echo \"$(cat <<'EOF'\nx")
    assert read(early).heredoc_commit is None  # its own EOF line would end the heredoc early


def test_a_heredoc_commits_message_is_not_a_push():
    cmd = "git commit -m \"$(cat <<'EOF'\nfix: block git push --force\nEOF\n)\""
    assert read(cmd).push is None
    assert read(cmd + " && git push -f").push == "deny"  # not a heredoc commit any more


def test_args_paths_and_cd():
    args = read("cd ../web && cat 'a b' src/x.py --file=./y -C repo # z ~/k https://x.y/z").args
    got = {a.value: (a.path, a.cd) for a in args}
    assert got["../web"] == (True, True)
    assert got["a b"] == (False, False) and got["src/x.py"] == (True, False)
    assert got["./y"] == (True, False)  # --flag=value: the value
    assert got["repo"] == (True, False)  # after -C
    assert got["z"] == (False, False) and got["~/k"] == (True, False)  # words after "#" still count
    assert got["https://x.y/z"] == (False, False)
    assert {a.value for a in read("cat 'unbalanced ../x").args} >= {"../x"}  # a lex error still reads the words


def test_globs_count_as_paths_and_never_as_read_only_flags():
    assert read("ls *.env").args[1].path
    for cmd in ("ls -*", "find . -name x -*", "cat ?", "grep x [a-z]*"):
        assert not read(cmd).read_only, cmd
    assert read("ls '*.env'").read_only and read('grep -rn --include="*.ts" x .').read_only


def test_recursive():
    for cmd in ("rg foo", "grep -r x .", "grep -nr x .", "grep -rn x .", "grep -nRi x .", "grep -rC2 x .",
                "grep -5r x .", "grep '-rn' x .", "grep -d recurse x .", "grep --directories=recurse x .",
                "grep --dereference-recursive x .", "ls -R",
                "bash -c 'grep -rn x .'", "sh -c \"grep --recursive x .\"", "grep --recur x .", "grep --dir=rec x .",
                "grep -d rec x .", "grep -drecurse x .", "find .", "grep --recursive x", "tar cf a.tar .",
                # quotes, backslashes and expansions the shell turns into a flag
                "grep -\"\"r x .", "grep \"-\"r x .", "grep -\\r x .", "grep -n\\r x .", "grep -nd r x .",
                "grep -nd 'r' x .", "grep {-r,x} .", "grep -$'\\x72' x .", "grep $F x .", "grep `echo -r` x .",
                "grep -[r] x .", "f\"\"ind .", "bash -c 'grep -\"\"r x .'"):
        assert read(cmd).recursive, cmd
    for cmd in ("cat a", "ls -la", "grep -n x f", "git pull --rebase", "cat -- -x", "grep -d skip x .",
                "grep --include=*.py x f", "grep '$x' f", "grep '{a,b}' f",
                "git commit -m \"$(cat <<'EOF'\nfix: grep -r $X {a}\nEOF\n)\""):
        assert not read(cmd).recursive, cmd
    assert read("awk '{print $1}' f").recursive  # a quoted script's words are read like a command: fails closed


@pytest.mark.parametrize("cmd,verdict", [
    ("git push", None), ("git push -u origin main", None), ("git status", None), ("docker push img", "ask"),
    ("git push -f", "deny"), ("git 'push' --force", "deny"), ("git pu\\sh -f", "ask"),
    ("git push --mirror", "ask"), ("git -c x=y push", "ask"), ("git push $R", "ask"), ("git log *", "ask"),
    ("git push origin a b c", "ask"), ("git pull && git push origin +main", "deny"),
])
def test_push(cmd, verdict):
    assert read(cmd).push == verdict


def test_one_reading_per_command():
    assert read("git log --oneline") is read("git log --oneline")
