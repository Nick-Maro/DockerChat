"""Regression tests use temporary SQLite databases; no Redis or Docker is needed."""
from contextlib import redirect_stdout
import importlib
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard"))
sys.path.insert(0, str(ROOT))
import auth
from tools.setup_env import create_environment


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "dashboard.db"
        self.db_patch = patch.object(auth, "DATABASE_PATH", str(self.path))
        self.db_patch.start()
        self.env_patch = patch.dict(os.environ, {"ADMIN_USERNAME": "testadmin", "ADMIN_PASSWORD": "unique-test-password"})
        self.env_patch.start()

    def tearDown(self):
        self.env_patch.stop()
        self.db_patch.stop()
        self.directory.cleanup()

    def test_bootstrap_requires_explicit_credentials(self):
        with patch.dict(os.environ, {"ADMIN_PASSWORD": ""}):
            with self.assertRaisesRegex(ValueError, "ADMIN_USERNAME and ADMIN_PASSWORD"):
                auth.init_db()
        self.assertIsNone(auth.get_user_by_username("testadmin"))

    def test_password_is_hashed_and_never_printed(self):
        output = io.StringIO()
        with redirect_stdout(output):
            auth.init_db()
        user = auth.get_user_by_username("testadmin")
        self.assertTrue(auth.verify_password(user, "unique-test-password"))
        self.assertFalse(auth.verify_password(user, "admin123"))
        self.assertNotIn("unique-test-password", output.getvalue())
        self.assertNotEqual(user.password_hash, "unique-test-password")

    def test_restart_preserves_existing_accounts(self):
        auth.init_db()
        with patch.dict(os.environ, {"ADMIN_PASSWORD": "different-password"}):
            auth.init_db()
        self.assertTrue(auth.verify_password(auth.get_user_by_username("testadmin"), "unique-test-password"))

    def test_create_duplicate_delete_user(self):
        auth.init_db()
        user = auth.create_user("guest", "guest-test-password")
        self.assertIsNotNone(user)
        self.assertIsNone(auth.create_user("guest", "another-password"))
        self.assertTrue(auth.delete_user(user.id))
        self.assertIsNone(auth.get_user_by_id(user.id))


class DashboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.env_patch = patch.dict(os.environ, {
            "SECRET_KEY": "test-session-key", "ADMIN_USERNAME": "admin", "ADMIN_PASSWORD": "test-password",
        })
        cls.env_patch.start()
        cls.db_patch = patch.object(auth, "DATABASE_PATH", str(Path(cls.directory.name) / "dashboard.db"))
        cls.db_patch.start()
        # Avoid connecting to real services or creating platform-specific /var paths.
        import redis
        with patch("redis.Redis", side_effect=redis.exceptions.ConnectionError("test: Redis unavailable")), patch("os.makedirs"):
            cls.module = importlib.import_module("app")
        cls.module.app.config.update(TESTING=True)

    @classmethod
    def tearDownClass(cls):
        cls.db_patch.stop()
        cls.env_patch.stop()
        cls.directory.cleanup()

    def test_unauthenticated_dashboard_requires_login(self):
        response = self.module.app.test_client().get("/")
        self.assertEqual(response.status_code, 302)
        self.assertIn("/login", response.location)

    def test_login_preserves_local_return_path(self):
        response = self.module.app.test_client().post("/login?next=/stats", data={"username": "admin", "password": "test-password"})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.location, "/stats")

    def test_login_rejects_external_return_paths(self):
        for target in ["https://example.invalid", "//example.invalid", "/\\example.invalid"]:
            with self.subTest(target=target):
                response = self.module.app.test_client().post("/login", query_string={"next": target}, data={"username": "admin", "password": "test-password"})
                self.assertEqual(response.location, "/")


class SetupTests(unittest.TestCase):
    def test_credentials_are_unique_and_existing_configuration_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / "one.env", Path(directory) / "two.env"]
            for path in paths:
                create_environment(ROOT / ".env.template", path)
            self.assertNotEqual(paths[0].read_text(), paths[1].read_text())
            original = paths[0].read_bytes()
            with self.assertRaises(FileExistsError):
                create_environment(ROOT / ".env.template", paths[0])
            self.assertEqual(paths[0].read_bytes(), original)
            self.assertNotIn("replace-with", paths[0].read_text())


if __name__ == "__main__":
    unittest.main()
