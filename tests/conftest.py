import os
import tempfile

# Tests never read or write the real ~/.orb (settings, sessions, token): a fresh state folder per run.
os.environ["ORB_STATE"] = tempfile.mkdtemp(prefix="orb-test-")
os.environ["ORB_HOSTS"] = "testserver"  # Starlette's TestClient
os.environ["ORB_DROPS"] = os.path.join(os.environ["ORB_STATE"], "drops")
