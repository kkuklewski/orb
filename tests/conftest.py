import os
import tempfile

# Tests never read or write the real ~/.orb (settings, sessions, token): a fresh state folder per run.
os.environ["ORB_STATE"] = tempfile.mkdtemp(prefix="orb-test-")
os.environ["ORB_HOSTS"] = "testserver"  # Starlette's TestClient
os.environ["ORB_DROPS"] = os.path.join(os.environ["ORB_STATE"], "drops")

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def personal_profile(monkeypatch):
    """Most tests cover the personal profile (other repos ask, Brain, browser speech); test_profile.py and the
    tests that ask for `work` cover the work profile, a new install's default."""
    from orb import settings
    monkeypatch.setitem(settings.settings.data, "profile", "personal")


@pytest.fixture
def work(monkeypatch):
    from orb import settings
    monkeypatch.setitem(settings.settings.data, "profile", "work")
