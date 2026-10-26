import os

import pytest

from orb import billing


@pytest.mark.parametrize("var", ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK"])
def test_refuses_when_a_billing_variable_is_set(var):
    with pytest.raises(billing.BillingError, match=var):
        billing.assert_subscription_env({var: "sk-ant-x", "HOME": "/x"})


def test_accepts_clean_env_and_blank_values():
    billing.assert_subscription_env({"HOME": "/x", "ANTHROPIC_API_KEY": ""})


def test_clean_env_drops_keys():
    env = billing.clean_env({"ANTHROPIC_API_KEY": "k", "ANTHROPIC_AUTH_TOKEN": "t", "PATH": "/bin"})
    assert env == {"PATH": "/bin"}


def test_sdk_env_rechecks_process_env(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-late")
    with pytest.raises(billing.BillingError):
        billing.sdk_env()


def test_sdk_env_blanks_every_forbidden_variable(monkeypatch):
    for v in billing.FORBIDDEN_ENV:
        monkeypatch.delenv(v, raising=False)
    env = billing.sdk_env()
    assert set(env) == set(billing.FORBIDDEN_ENV) and not any(env.values())


def test_init_check():
    assert billing.check_init({"apiKeySource": "none"}) == "none"
    for src in ("ANTHROPIC_API_KEY", "apiKeyHelper", "/login managed key", ""):
        with pytest.raises(billing.BillingError):
            billing.check_init({"apiKeySource": src})


def test_main_exits_when_key_is_set(monkeypatch):
    import orb

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-x")
    with pytest.raises(SystemExit) as e:
        orb.main()
    assert e.value.code == 2


def test_base_url_is_refused_like_a_key():
    assert billing.forbidden_vars({"ANTHROPIC_BASE_URL": "https://proxy.example"}) == ["ANTHROPIC_BASE_URL"]


def test_tracker_tokens_leave_the_environment_at_startup(monkeypatch):
    import importlib

    from orb import config
    monkeypatch.setenv("ORB_VIKUNJA_TOKEN", "tk-1")
    monkeypatch.setenv("ORB_JIRA_TOKEN", "tk-2")
    fresh = importlib.reload(config)
    try:
        assert "ORB_VIKUNJA_TOKEN" not in os.environ and "ORB_JIRA_TOKEN" not in os.environ
        assert fresh.secret("VIKUNJA_TOKEN") == "tk-1" and fresh.secret("JIRA_TOKEN") == "tk-2"
    finally:
        fresh._secrets.clear()
